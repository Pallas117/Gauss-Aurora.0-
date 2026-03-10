#!/usr/bin/env python3
"""Lightweight local inference server for nowcasting API integration."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List

MODEL_VERSION = "unet-baseline-v1"
DEFAULT_REGISTRY_PATH = "ml/models/registry.json"


@dataclass(frozen=True)
class LearnedInferenceProfile:
  model_version: str = MODEL_VERSION
  perturb_mean: float | None = None
  aurora_mean: float | None = None
  blend: float = 0.0


_profile_cache_lock = Lock()
_profile_cache_key: tuple[str, int] | None = None
_profile_cache_value = LearnedInferenceProfile()


def _clamp(value: float, low: float, high: float) -> float:
  return max(low, min(high, value))


def _as_float(value: Any) -> float | None:
  try:
    num = float(value)
  except (TypeError, ValueError):
    return None
  if math.isfinite(num):
    return num
  return None


def _select_latest_ready_model(models: list[Any]) -> dict[str, Any] | None:
  entries: list[tuple[int, dict[str, Any], float]] = []
  for idx, raw in enumerate(models):
    if not isinstance(raw, dict):
      continue
    status = str(raw.get("status", "ready")).lower()
    if status != "ready":
      continue
    trained_at = raw.get("trained_at")
    parsed = float("-inf")
    if isinstance(trained_at, str):
      try:
        parsed_ts = datetime.fromisoformat(trained_at.replace("Z", "+00:00")).timestamp()
        parsed = parsed_ts if math.isfinite(parsed_ts) else float("-inf")
      except ValueError:
        parsed = float("-inf")
    entries.append((idx, raw, parsed if math.isfinite(parsed) else float("-inf")))

  if not entries:
    return None

  entries.sort(key=lambda row: (row[2], row[0]), reverse=True)
  return entries[0][1]


def _profile_from_model_entry(entry: dict[str, Any]) -> LearnedInferenceProfile:
  metrics = entry.get("metrics")
  metrics_dict = metrics if isinstance(metrics, dict) else {}
  predict_mean = metrics_dict.get("predict_mean")
  means = predict_mean if isinstance(predict_mean, list) else []
  perturb_mean = _as_float(means[0]) if len(means) > 0 else None
  aurora_mean = _as_float(means[1]) if len(means) > 1 else None
  samples = int(_as_float(metrics_dict.get("samples")) or 0)
  if samples < 0:
    samples = 0
  blend = (
    _clamp(0.18 + math.log10(samples + 1) * 0.22, 0.12, 0.5)
    if samples > 0 and (perturb_mean is not None or aurora_mean is not None)
    else 0.0
  )

  version_raw = entry.get("version")
  model_version = str(version_raw).strip() if isinstance(version_raw, str) else MODEL_VERSION
  if not model_version:
    model_version = MODEL_VERSION

  return LearnedInferenceProfile(
    model_version=model_version,
    perturb_mean=perturb_mean,
    aurora_mean=aurora_mean,
    blend=blend,
  )


def load_learned_profile() -> LearnedInferenceProfile:
  global _profile_cache_key
  global _profile_cache_value

  raw_path = (os.environ.get("NOWCAST_MODEL_REGISTRY_PATH") or DEFAULT_REGISTRY_PATH).strip()
  if not raw_path:
    raw_path = DEFAULT_REGISTRY_PATH
  registry_path = Path(raw_path).expanduser()
  if not registry_path.is_absolute():
    registry_path = Path.cwd() / registry_path

  try:
    stat = registry_path.stat()
  except FileNotFoundError:
    with _profile_cache_lock:
      _profile_cache_key = (str(registry_path), -1)
      _profile_cache_value = LearnedInferenceProfile()
    return _profile_cache_value
  except OSError:
    return LearnedInferenceProfile()

  cache_key = (str(registry_path), stat.st_mtime_ns)
  with _profile_cache_lock:
    if _profile_cache_key == cache_key:
      return _profile_cache_value

  try:
    parsed = json.loads(registry_path.read_text(encoding="utf-8"))
    models = parsed.get("models")
    model_list = models if isinstance(models, list) else []
    latest = _select_latest_ready_model(model_list)
    profile = _profile_from_model_entry(latest) if latest else LearnedInferenceProfile()
  except Exception:
    profile = LearnedInferenceProfile()

  with _profile_cache_lock:
    _profile_cache_key = cache_key
    _profile_cache_value = profile
  return profile


def _normalized_signal(value: Any) -> float:
  num = _as_float(value)
  return _clamp(num if num is not None else 0.0, 0.0, 1.0)


def _exogenous_context_bias(payload: Dict[str, Any]) -> float:
  exogenous = payload.get("exogenousSignals")
  if not isinstance(exogenous, dict):
    return 0.0

  earth_core = exogenous.get("earthCore")
  earth = earth_core if isinstance(earth_core, dict) else {}
  solar_system_raw = exogenous.get("solarSystem")
  solar_system = solar_system_raw if isinstance(solar_system_raw, dict) else {}

  core_score = (
    0.4 * _normalized_signal(earth.get("geomagneticJerkIndex"))
    + 0.35 * _normalized_signal(earth.get("schumannResonancePower"))
    + 0.25 * _normalized_signal(earth.get("coreRotationAnomaly"))
  )
  solar_system_score = (
    0.35 * _normalized_signal(solar_system.get("heliosphereCompression"))
    + 0.25 * _normalized_signal(solar_system.get("cosmicRayFlux"))
    + 0.25 * _normalized_signal(solar_system.get("planetaryAlignmentIndex"))
    + 0.15 * _normalized_signal(solar_system.get("lunarTidalIndex"))
  )

  return _clamp(core_score * 0.6 + solar_system_score * 0.6, -0.8, 0.8)


def _rag_method_prior_bias(payload: Dict[str, Any]) -> float:
  priors = payload.get("ragMethodPriors")
  if not isinstance(priors, list):
    return 0.0

  weighted = 0.0
  total = 0.0
  for item in priors:
    if not isinstance(item, dict):
      continue
    weight = _clamp(_as_float(item.get("weight")) or 0.0, -1.0, 1.0)
    confidence = _clamp(_as_float(item.get("confidence")) or 0.6, 0.0, 1.0)
    weighted += weight * confidence
    total += confidence

  if total <= 0:
    return 0.0
  return _clamp(weighted / total, -0.6, 0.6)


def infer(payload: Dict[str, Any]) -> Dict[str, Any]:
  learned_profile = load_learned_profile()
  context_bias = _exogenous_context_bias(payload)
  rag_bias = _rag_method_prior_bias(payload)
  horizon = int(payload.get("horizonMinutes", 60))
  sequence = payload.get("sequence", [])
  latest = sequence[-1] if sequence else {}

  sw = latest.get("solarWind", {})
  b = latest.get("magneticField", {})
  idx = latest.get("indices", {})
  coupling = latest.get("coupling", {})

  speed = float(sw.get("speed", 400.0))
  density = float(sw.get("density", 5.0))
  bz = float(b.get("z", 0.0))
  kp = float(idx.get("kp", 2.0))
  newell = float(coupling.get("newell", 0.0))

  steps = max(1, min(24, horizon // 5))
  now = datetime.now(tz=timezone.utc)
  predictions: List[Dict[str, float | str]] = []

  for i in range(steps):
    minutes = (i + 1) * 5
    driver = (
      max(0.0, -bz) * 0.45
      + (speed - 350.0) * 0.004
      + density * 0.05
      + newell / 8000.0
      + context_bias * 2.2
      + rag_bias * 1.6
    )
    perturb = kp * 8.0 + driver * 12.0
    aurora = _clamp((kp / 9.0) * 0.7 + driver * 0.03, 0.0, 1.0)
    if learned_profile.blend > 0:
      if learned_profile.perturb_mean is not None:
        perturb = perturb * (1 - learned_profile.blend) + learned_profile.perturb_mean * learned_profile.blend
      if learned_profile.aurora_mean is not None:
        aurora = _clamp(
          aurora * (1 - learned_profile.blend) + learned_profile.aurora_mean * learned_profile.blend,
          0.0,
          1.0,
        )

    predictions.append(
      {
        "timestamp": (now + timedelta(minutes=minutes)).isoformat(),
        "geomagneticPerturbation": perturb,
        "auroraIntensity": aurora,
        "confidence": max(0.35, min(0.95, 0.9 - i * 0.02)),
      }
    )

  return {
    "modelVersion": learned_profile.model_version,
    "generatedAt": now.isoformat(),
    "horizonMinutes": horizon,
    "predictions": predictions,
  }


class Handler(BaseHTTPRequestHandler):
  def _json(self, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def do_GET(self) -> None:
    if self.path == "/health":
      profile = load_learned_profile()
      self._json(200, {"ok": True, "modelVersion": profile.model_version})
      return
    self._json(404, {"error": "Not found"})

  def do_POST(self) -> None:
    if self.path != "/infer":
      self._json(404, {"error": "Not found"})
      return

    try:
      length = int(self.headers.get("Content-Length", "0"))
      raw = self.rfile.read(length)
      payload = json.loads(raw.decode("utf-8"))
      result = infer(payload)
      self._json(200, result)
    except Exception as exc:  # noqa: BLE001
      self._json(400, {"error": str(exc)})


def main() -> None:
  server = HTTPServer(("0.0.0.0", 8000), Handler)
  print("Inference server listening on :8000")
  server.serve_forever()


if __name__ == "__main__":
  main()
