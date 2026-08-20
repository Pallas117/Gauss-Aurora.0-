#!/usr/bin/env python3
"""Builds a training dataset from canonical 5s space-weather feed JSON.

Input format:
{
  "points": [
    {
      "timestamp": "...",
      "solarWind": {"speed": ..., "density": ...},
      "magneticField": {"x": ..., "y": ..., "z": ..., "bt": ...},
      "electricField": {"ey": ...},
      "coupling": {"newell": ..., "epsilon": ...},
      "indices": {"kp": ..., "dst": ...}
    }
  ]
}
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class FeatureSpec:
  name: str
  encoding: str
  scale: float = 1.0
  clamp_min: float | None = None
  clamp_max: float | None = None


FEATURE_SCHEMA_VERSION = "compact-v1"
FEATURE_SCHEMA: List[FeatureSpec] = [
  FeatureSpec("solar_wind_speed", "scaled-int16", scale=10.0, clamp_min=0.0, clamp_max=4000.0),
  FeatureSpec("solar_wind_density", "scaled-int16", scale=100.0, clamp_min=0.0, clamp_max=500.0),
  FeatureSpec("imf_bx", "scaled-int16", scale=100.0, clamp_min=-500.0, clamp_max=500.0),
  FeatureSpec("imf_by", "scaled-int16", scale=100.0, clamp_min=-500.0, clamp_max=500.0),
  FeatureSpec("imf_bz", "scaled-int16", scale=100.0, clamp_min=-500.0, clamp_max=500.0),
  FeatureSpec("imf_bt", "scaled-int16", scale=100.0, clamp_min=0.0, clamp_max=500.0),
  FeatureSpec("electric_ey", "scaled-int16", scale=100.0, clamp_min=-500.0, clamp_max=500.0),
  FeatureSpec("newell_coupling", "scaled-int16", scale=1.0, clamp_min=0.0, clamp_max=32000.0),
  FeatureSpec("epsilon_coupling", "float32"),
  FeatureSpec("kp_index", "uint8", scale=10.0, clamp_min=0.0, clamp_max=9.0),
  FeatureSpec("dst_index", "scaled-int16", scale=1.0, clamp_min=-2000.0, clamp_max=2000.0),
]


@dataclass
class WindowExample:
  x: List[List[float | int]]
  y: List[float]
  timestamp: str
  schemaVersion: str | None = None
  compact: bool = False


def _clamp(value: float, low: float | None, high: float | None) -> float:
  if low is not None and value < low:
    value = low
  if high is not None and value > high:
    value = high
  return value


def _to_float32(value: float) -> float:
  return round(float(value), 6)


def _encode_value(value: float, spec: FeatureSpec) -> float | int:
  bounded = _clamp(float(value), spec.clamp_min, spec.clamp_max)
  if spec.encoding == "scaled-int16":
    return int(round(bounded * spec.scale))
  if spec.encoding == "uint8":
    return int(round(_clamp(bounded, 0.0, 255.0) * spec.scale))
  return _to_float32(bounded)


def compact_feature_vector(vector: List[float]) -> List[float | int]:
  if len(vector) != len(FEATURE_SCHEMA):
    raise ValueError(f"Expected {len(FEATURE_SCHEMA)} features, got {len(vector)}")
  return [_encode_value(value, spec) for value, spec in zip(vector, FEATURE_SCHEMA)]


def feature_vector(point: dict) -> List[float]:
  sw = point.get("solarWind", {})
  b = point.get("magneticField", {})
  e = point.get("electricField", {})
  c = point.get("coupling", {})
  i = point.get("indices", {})
  return [
    float(sw.get("speed", 0.0)),
    float(sw.get("density", 0.0)),
    float(b.get("x", 0.0)),
    float(b.get("y", 0.0)),
    float(b.get("z", 0.0)),
    float(b.get("bt", 0.0)),
    float(e.get("ey", 0.0)),
    float(c.get("newell", 0.0)),
    float(c.get("epsilon", 0.0)),
    float(i.get("kp", 0.0)),
    float(i.get("dst", 0.0)),
  ]


def target_vector(point: dict) -> List[float]:
  i = point.get("indices", {})
  kp = float(i.get("kp", 0.0))
  dst = float(i.get("dst", 0.0))
  # Placeholder targets: perturbation and auroral intensity.
  perturb = max(0.0, kp * 10.0 - dst * 0.1)
  aurora = min(1.0, max(0.0, kp / 9.0 + max(0.0, -dst) / 400.0))
  return [_to_float32(perturb), _to_float32(aurora)]


def build_examples(
  points: List[dict],
  input_steps: int,
  horizon_steps: int,
  compact: bool = True,
) -> List[WindowExample]:
  examples: List[WindowExample] = []
  for end in range(input_steps, len(points) - horizon_steps):
    context = points[end - input_steps : end]
    future = points[end + horizon_steps - 1]
    x_raw = [feature_vector(item) for item in context]
    x = [compact_feature_vector(item) for item in x_raw] if compact else x_raw
    y = target_vector(future)
    examples.append(
      WindowExample(
        x=x,
        y=y,
        timestamp=future.get("timestamp", ""),
        schemaVersion=FEATURE_SCHEMA_VERSION if compact else None,
        compact=compact,
      ),
    )
  return examples


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True, help="Path to JSON feed input")
  parser.add_argument("--output", required=True, help="Path to dataset JSONL output")
  parser.add_argument("--input-steps", type=int, default=24, help="Input timesteps")
  parser.add_argument("--horizon-steps", type=int, default=12, help="Forecast timesteps")
  parser.add_argument(
    "--compact",
    dest="compact",
    action="store_true",
    help="Apply bounded numeric compaction for edge-safe datasets (default).",
  )
  parser.add_argument(
    "--no-compact",
    dest="compact",
    action="store_false",
    help="Disable bounded numeric compaction.",
  )
  parser.set_defaults(compact=True)
  args = parser.parse_args()

  payload = json.loads(Path(args.input).read_text())
  points = payload.get("points", [])

  examples = build_examples(points, args.input_steps, args.horizon_steps, compact=args.compact)

  output_path = Path(args.output)
  output_path.parent.mkdir(parents=True, exist_ok=True)
  with output_path.open("w", encoding="utf-8") as f:
    for ex in examples:
      payload = {
        "x": ex.x,
        "y": ex.y,
        "timestamp": ex.timestamp,
        "compact": ex.compact,
      }
      if ex.schemaVersion:
        payload["schemaVersion"] = ex.schemaVersion
      f.write(json.dumps(payload) + "\n")

  print(f"Wrote {len(examples)} examples to {output_path}")


if __name__ == "__main__":
  main()
