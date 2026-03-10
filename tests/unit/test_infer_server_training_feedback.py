from __future__ import annotations

import json
import subprocess
from pathlib import Path

from ml.infer import infer_server


def _payload() -> dict:
  return {
    "horizonMinutes": 60,
    "sequence": [
      {
        "timestamp": "2026-03-05T00:00:00Z",
        "solarWind": {"speed": 710.0, "density": 14.0},
        "magneticField": {"z": -12.5},
        "indices": {"kp": 7.0},
        "coupling": {"newell": 14500.0},
      }
    ],
  }


def _mean(predictions: list[dict], field: str) -> float:
  values = [float(point[field]) for point in predictions]
  return sum(values) / max(len(values), 1)


def test_train_unet_registry_changes_infer_server_output(monkeypatch, tmp_path: Path) -> None:
  payload = _payload()
  monkeypatch.setenv("NOWCAST_MODEL_REGISTRY_PATH", str(tmp_path / "missing-registry.json"))
  baseline = infer_server.infer(payload)

  dataset_path = tmp_path / "train_dataset.jsonl"
  registry_path = tmp_path / "registry.json"
  learned_version = "unet-learning-regression-py-v1"
  dataset_rows = [
    {"x": [[1, 2, 3]], "y": [420.0, 0.91], "timestamp": "2026-03-05T00:00:00Z"},
    {"x": [[2, 3, 4]], "y": [460.0, 0.94], "timestamp": "2026-03-05T00:05:00Z"},
    {"x": [[3, 4, 5]], "y": [510.0, 0.97], "timestamp": "2026-03-05T00:10:00Z"},
    {"x": [[4, 5, 6]], "y": [470.0, 0.93], "timestamp": "2026-03-05T00:15:00Z"},
  ]
  dataset_path.write_text("".join(f"{json.dumps(row)}\n" for row in dataset_rows), encoding="utf-8")

  repo_root = Path(__file__).resolve().parents[2]
  train = subprocess.run(
    [
      "python3",
      "ml/train/train_unet.py",
      "--dataset",
      str(dataset_path),
      "--registry",
      str(registry_path),
      "--model-version",
      learned_version,
      "--epochs",
      "2",
    ],
    cwd=str(repo_root),
    capture_output=True,
    text=True,
    check=False,
  )
  assert train.returncode == 0, train.stderr or train.stdout

  monkeypatch.setenv("NOWCAST_MODEL_REGISTRY_PATH", str(registry_path))
  learned = infer_server.infer(payload)

  assert learned["modelVersion"] == learned_version
  assert len(learned["predictions"]) == len(baseline["predictions"])

  baseline_perturb = _mean(baseline["predictions"], "geomagneticPerturbation")
  learned_perturb = _mean(learned["predictions"], "geomagneticPerturbation")
  baseline_aurora = _mean(baseline["predictions"], "auroraIntensity")
  learned_aurora = _mean(learned["predictions"], "auroraIntensity")

  assert abs(learned_perturb - baseline_perturb) > 1e-3 or abs(learned_aurora - baseline_aurora) > 1e-4

