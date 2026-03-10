"""Tests for backend.gauss_physics_imputer.GaussPhysicsImputer."""

from __future__ import annotations

import gc

import polars as pl
import pytest

import backend.gauss_physics_imputer as module
from backend.gauss_physics_imputer import GaussPhysicsImputer


def test_identify_corrupted_data_flags_radiation_bitflip() -> None:
    imputer = GaussPhysicsImputer(sensitivity=3.5)
    series = pl.Series("particleFlux", [1.2e-4, 0.9, 1.3e-4, 1.1e-4, 1.4e-4, 1.25e-4])
    mask = imputer.identify_corrupted_data(series)

    assert mask.len() == series.len()
    assert mask[1] is True
    assert int(mask.sum()) >= 1


def test_reconstruct_telemetry_returns_actionable_payload() -> None:
    imputer = GaussPhysicsImputer(sensitivity=3.5, min_valid_points=5)
    frame = pl.DataFrame(
        {
            "timestamp": [1, 2, 3, 4, 5, 6],
            "particleFlux": [1.2e-4, 0.9, 1.3e-4, 1.1e-4, 1.4e-4, 1.25e-4],
        }
    )

    result = imputer.reconstruct_telemetry(frame, "particleFlux")
    assert result["success"] is True
    assert result["target_column"] == "particleFlux"
    assert result["anomalies_detected"] >= 1
    assert len(result["reconstructed_series"]) == frame.height
    assert len(result["corrupted_mask"]) == frame.height
    assert 0.0 <= float(result["integrity_score"]) <= 1.0
    assert isinstance(result["insight"], str) and len(result["insight"]) > 0


def test_reconstruct_handles_low_density() -> None:
    imputer = GaussPhysicsImputer(min_valid_points=5)
    frame = pl.DataFrame(
        {
            "timestamp": [1, 2, 3, 4],
            "particleFlux": [1.2e-4, 0.9, 1.3e-4, 0.95],
        }
    )

    result = imputer.reconstruct_telemetry(frame, "particleFlux")
    assert result["success"] is False
    assert result["error"] == "insufficient_valid_points"
    assert "Data density too low" in result["insight"]


def test_missing_target_column_raises() -> None:
    imputer = GaussPhysicsImputer()
    frame = pl.DataFrame({"timestamp": [1, 2, 3], "other": [1.0, 2.0, 3.0]})
    with pytest.raises(KeyError):
        imputer.reconstruct_telemetry(frame, "particleFlux")


def test_linear_fallback_when_scipy_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "SCIPY_AVAILABLE", False)
    monkeypatch.setattr(module, "_UnivariateSpline", None)

    imputer = GaussPhysicsImputer(min_valid_points=3)
    frame = pl.DataFrame(
        {
            "timestamp": [1, 2, 3, 4, 5, 6],
            "particleFlux": [1.0, 1.1, 1.2, 8.0, 1.3, 1.4],
        }
    )
    result = imputer.reconstruct_telemetry(frame, "particleFlux")

    assert result["success"] is True
    assert result["method"] == "linear_interp"
    assert len(result["reconstructed_series"]) == frame.height


def test_reconstruct_telemetry_invokes_gc_collect(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reconstruct with medium-sized data invokes gc.collect for memory safety (8GB M1)."""
    collect_calls: list[tuple] = []
    original_collect = gc.collect

    def tracked_collect(*args: object, **kwargs: object) -> object:
        collect_calls.append(("collect", args, kwargs))
        return original_collect(*args, **kwargs)

    monkeypatch.setattr(gc, "collect", tracked_collect)

    imputer = GaussPhysicsImputer(min_valid_points=5)
    n = 500
    frame = pl.DataFrame(
        {
            "timestamp": list(range(n)),
            "particleFlux": [1.2e-4 + (i % 10) * 0.01 for i in range(n)],
        }
    )
    result = imputer.reconstruct_telemetry(frame, "particleFlux")

    assert result["success"] is True
    assert len(collect_calls) >= 1, "reconstruct_telemetry should call gc.collect at least once"
