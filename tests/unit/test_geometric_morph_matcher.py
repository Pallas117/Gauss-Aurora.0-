"""Tests for backend.geometric_morph_matcher.GeometricMorphMatcher."""

from __future__ import annotations

import pytest

from backend.geometric_morph_matcher import GeometricMorphMatcher


def test_zero_delta_when_geometry_matches() -> None:
    matcher = GeometricMorphMatcher(tolerance=0.05)
    nominal = [[1.0, 1.0, 1.0], [0.5, -0.2, 0.8]]
    live = [[1.0, 1.0, 1.0], [0.5, -0.2, 0.8]]

    delta = matcher.calculate_morph_delta(nominal, live)
    assert delta == pytest.approx(0.0)

    audit = matcher.audit_physical_integrity("asset-a", live, nominal)
    assert audit["status"] == "GEOMETRY_NOMINAL"
    assert audit["confidence"] == pytest.approx(1.0)


def test_detects_anomaly_above_threshold() -> None:
    matcher = GeometricMorphMatcher(tolerance=0.05)
    audit = matcher.audit_physical_integrity("CubeSat-01", [1.02, 0.98, 1.08])

    assert audit["status"] == "ANOMALY_DETECTED"
    assert float(audit["morph_delta"]) > 0.05
    assert 0.0 <= float(audit["confidence"]) <= 1.0


def test_register_nominal_mesh_used_when_not_passed() -> None:
    matcher = GeometricMorphMatcher(tolerance=0.05)
    matcher.register_nominal_mesh("asset-b", [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])

    nominal_audit = matcher.audit_physical_integrity(
        "asset-b",
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
    )
    drift_audit = matcher.audit_physical_integrity(
        "asset-b",
        [[0.2, 0.0, 0.0], [1.3, 0.0, 0.0]],
    )

    assert nominal_audit["status"] == "GEOMETRY_NOMINAL"
    assert drift_audit["status"] == "ANOMALY_DETECTED"


def test_shape_mismatch_raises_value_error() -> None:
    matcher = GeometricMorphMatcher()
    with pytest.raises(ValueError):
        matcher.calculate_morph_delta([[1.0, 1.0, 1.0]], [[1.0, 1.0, 1.0], [0.0, 0.0, 0.0]])


def test_invalid_vertices_raise() -> None:
    matcher = GeometricMorphMatcher()
    with pytest.raises(ValueError):
        matcher.calculate_morph_delta([1.0, 2.0], [1.0, 2.0, 3.0])
    with pytest.raises(ValueError):
        matcher.calculate_morph_delta([], [1.0, 2.0, 3.0])  # type: ignore[arg-type]


def test_confidence_bounded_for_large_deviation() -> None:
    matcher = GeometricMorphMatcher(tolerance=0.05)
    audit = matcher.audit_physical_integrity("asset-c", [5.0, -3.0, 2.0])
    assert 0.0 <= float(audit["confidence"]) <= 1.0
    assert float(audit["delta_ratio"]) > 1.0
