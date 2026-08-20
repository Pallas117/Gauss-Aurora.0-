from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_BUILDER_PATH = REPO_ROOT / "ml" / "train" / "dataset_builder.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("gauss_dataset_builder", DATASET_BUILDER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_build_examples_compacts_training_windows() -> None:
    module = _load_module()
    points = [
        {
            "timestamp": f"2026-03-12T00:{index:02d}:00Z",
            "solarWind": {"speed": 700 + index, "density": 12.5},
            "magneticField": {"x": 2.4, "y": -1.2, "z": -8.7, "bt": 9.1},
            "electricField": {"ey": 4.2},
            "coupling": {"newell": 14500, "epsilon": 8.2e10},
            "indices": {"kp": 6.0, "dst": -94.0},
        }
        for index in range(5)
    ]

    examples = module.build_examples(points, input_steps=2, horizon_steps=1, compact=True)

    assert len(examples) == 2
    first = examples[0]
    assert first.compact is True
    assert first.schemaVersion == module.FEATURE_SCHEMA_VERSION
    assert isinstance(first.x[0][0], int)
    assert isinstance(first.x[0][8], float)
    assert first.x[0][0] == 7000


def test_build_examples_can_preserve_float_windows() -> None:
    module = _load_module()
    points = [
        {
            "timestamp": f"2026-03-12T01:{index:02d}:00Z",
            "solarWind": {"speed": 400 + index, "density": 5.1},
            "magneticField": {"x": 1.0, "y": 0.2, "z": -2.3, "bt": 2.7},
            "electricField": {"ey": 0.4},
            "coupling": {"newell": 350.0, "epsilon": 4.2e9},
            "indices": {"kp": 2.0, "dst": -15.0},
        }
        for index in range(5)
    ]

    examples = module.build_examples(points, input_steps=2, horizon_steps=1, compact=False)

    assert len(examples) == 2
    first = examples[0]
    assert first.compact is False
    assert first.schemaVersion is None
    assert isinstance(first.x[0][0], float)
