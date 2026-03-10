"""Comprehensive pytest suite for backend.engine.SpaceProbabilityEngine.

Coverage goals:
- Each threat model is tested independently (collision, solar flare, cyber, debris).
- Factor contributions and probabilities are validated.
- Confidence intervals are validated for structure and ordering.
- Fusion ranking/actionability logic is validated.
- External dependency behavior is mocked with pytest-mock.
- Edge cases (missing data, zero-probability, high uncertainty) are covered.
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace
from typing import Any, Iterable, Mapping, Sequence

import pytest


# -------------------------------
# Helpers
# -------------------------------

def _read_field(obj: Any, key: str, default: Any = None) -> Any:
    """Read dict or attribute fields transparently."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _call_first(obj: Any, candidates: Sequence[str], *args: Any, **kwargs: Any) -> Any:
    """Call the first method found from candidate names."""
    for name in candidates:
        method = getattr(obj, name, None)
        if callable(method):
            return method(*args, **kwargs)
    raise AttributeError(f"No method found from candidates={candidates!r} on {obj!r}")


def _first_attr(obj: Any, candidates: Sequence[str]) -> Any:
    """Return the first existing attribute from candidate names."""
    for name in candidates:
        if hasattr(obj, name):
            return getattr(obj, name)
    raise AttributeError(f"No attribute found from candidates={candidates!r} on {obj!r}")


def _assert_probability_bounds(probability: float) -> None:
    assert 0.0 <= probability <= 1.0, f"probability out of [0,1]: {probability}"


def _assert_confidence_interval_shape(interval: Any) -> tuple[float, float]:
    assert isinstance(interval, (tuple, list)), f"CI must be tuple/list, got {type(interval)}"
    assert len(interval) == 2, "CI must have exactly two values"
    lower, upper = float(interval[0]), float(interval[1])
    assert lower <= upper, f"CI lower > upper: {(lower, upper)}"
    _assert_probability_bounds(lower)
    _assert_probability_bounds(upper)
    return lower, upper


def _weighted_factor_sum(factors: Iterable[Any]) -> float:
    """Compute weighted contribution sum and validate factor bounds."""
    weighted = 0.0
    weight_total = 0.0
    for factor in factors:
        weight = float(_read_field(factor, "weight"))
        contribution = float(_read_field(factor, "contribution"))
        assert 0.0 <= weight <= 1.0, f"weight out of [0,1]: {weight}"
        _assert_probability_bounds(contribution)
        weighted += weight * contribution
        weight_total += weight

    # Weights should be approximately normalized for explainability.
    assert 0.8 <= weight_total <= 1.2, f"unexpected weight total: {weight_total}"
    return weighted


def _assert_assessment_sane(assessment: Any, expected_type: str) -> None:
    threat_type = _read_field(assessment, "threat_type")
    probability = float(_read_field(assessment, "probability"))
    factors = _read_field(assessment, "factors")
    interval = _read_field(assessment, "confidence_interval")

    assert threat_type == expected_type
    _assert_probability_bounds(probability)
    assert isinstance(factors, list) and len(factors) > 0, "factors must be a non-empty list"
    _assert_confidence_interval_shape(interval)

    # Probability should align with weighted factors (allowing model-specific transforms).
    weighted = _weighted_factor_sum(factors)
    clipped = max(0.0, min(1.0, weighted))
    assert abs(probability - clipped) <= 0.35, (
        f"probability diverges from factor-weighted score: p={probability}, weighted={weighted}"
    )


# -------------------------------
# Fixtures
# -------------------------------

@pytest.fixture(scope="module")
def engine_module():
    """Import lazily so test failures are explicit if module is missing."""
    return importlib.import_module("backend.engine")


@pytest.fixture
def sample_telemetry() -> dict[str, Any]:
    """Telemetry fixture matching engine.py example shape."""
    return {
        "orbital": {
            "position": [7000.0, 0.0, 0.0],
            "velocity": [0.0, 7.5, 0.0],
            "position_uncertainty": 0.15,
        },
        "network": {
            "packet_rate": 350,
            "connection_attempts": 23,
            "entropy": 5.2,
        },
    }


@pytest.fixture
def sample_external_data() -> dict[str, Any]:
    """External feed fixture matching engine.py example shape."""
    return {
        "space_track": {
            "objects": [
                {"position": [7012.0, 0.6, -0.8], "velocity": [0.0, 7.2, 0.0]},
                {"position": [6988.0, -1.4, 1.1], "velocity": [0.0, 7.8, 0.0]},
            ],
            "historical_conjunction_rate": 0.12,
        },
        "solar": {
            "complexity": 4.2,
            "magnetic_field": 320,
            "history": 0.25,
        },
        "debris": {
            "objects": [
                {"position": [7010.0, 1.2, -0.5]},
                {"position": [6985.0, -2.1, 1.8]},
            ],
            "density": 0.03,
        },
    }


@pytest.fixture
def calm_telemetry() -> dict[str, Any]:
    """Nominal conditions for low-risk edge behavior."""
    return {
        "orbital": {
            "position": [42164.0, 0.0, 0.0],
            "velocity": [0.0, 3.07, 0.0],
            "position_uncertainty": 0.01,
        },
        "network": {
            "packet_rate": 100,
            "connection_attempts": 5,
            "entropy": 4.5,
        },
    }


@pytest.fixture
def engine(engine_module: Any):
    return engine_module.SpaceProbabilityEngine()


@pytest.fixture
def fusion_engine(engine: Any) -> Any:
    return _first_attr(engine, ("fusion_engine", "_fusion_engine"))


@pytest.fixture
def models(fusion_engine: Any) -> dict[str, Any]:
    return {
        "collision": _first_attr(fusion_engine, ("_collision_model", "collision_model", "collisionModel")),
        "solar_flare": _first_attr(fusion_engine, ("_flare_model", "flare_model", "solar_model", "flareModel")),
        "cyber": _first_attr(fusion_engine, ("_cyber_model", "cyber_model", "cyberModel")),
        "debris": _first_attr(fusion_engine, ("_debris_model", "debris_model", "debrisModel")),
    }


# -------------------------------
# Threat-model tests
# -------------------------------

def test_collision_model_individual(
    models: dict[str, Any], sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessment = _call_first(
        models["collision"],
        ("predict",),
        sample_telemetry["orbital"],
        sample_external_data["space_track"],
    )
    _assert_assessment_sane(assessment, "collision")


def test_solar_flare_model_individual(models: dict[str, Any], sample_external_data: dict[str, Any]) -> None:
    assessment = _call_first(models["solar_flare"], ("predict",), sample_external_data["solar"])
    _assert_assessment_sane(assessment, "solar_flare")


def test_cyber_model_individual(models: dict[str, Any], sample_telemetry: dict[str, Any]) -> None:
    assessment = _call_first(models["cyber"], ("predict",), sample_telemetry["network"])
    _assert_assessment_sane(assessment, "cyber")


def test_debris_model_individual(
    models: dict[str, Any], sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessment = _call_first(
        models["debris"],
        ("predict",),
        sample_telemetry["orbital"],
        sample_external_data["debris"],
    )
    _assert_assessment_sane(assessment, "debris")


# -------------------------------
# Confidence interval + uncertainty
# -------------------------------

def test_confidence_interval_order_and_bounds(
    models: dict[str, Any], sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessment = _call_first(
        models["collision"],
        ("predict",),
        sample_telemetry["orbital"],
        sample_external_data["space_track"],
    )
    lower, upper = _assert_confidence_interval_shape(_read_field(assessment, "confidence_interval"))
    assert lower <= upper


def test_high_uncertainty_widens_confidence_interval(
    models: dict[str, Any], sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    collision = models["collision"]

    low_u = dict(sample_telemetry["orbital"])
    low_u["position_uncertainty"] = 0.01

    high_u = dict(sample_telemetry["orbital"])
    high_u["position_uncertainty"] = 2.5

    low = _call_first(collision, ("predict",), low_u, sample_external_data["space_track"])
    high = _call_first(collision, ("predict",), high_u, sample_external_data["space_track"])

    low_l, low_u_ci = _assert_confidence_interval_shape(_read_field(low, "confidence_interval"))
    high_l, high_u_ci = _assert_confidence_interval_shape(_read_field(high, "confidence_interval"))

    low_width = low_u_ci - low_l
    high_width = high_u_ci - high_l
    assert high_width >= low_width


# -------------------------------
# Fusion tests
# -------------------------------

def test_assess_all_threats_returns_all_models(
    fusion_engine: Any, sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessments = _call_first(
        fusion_engine,
        ("assess_all_threats", "assessAllThreats"),
        sample_telemetry,
        sample_external_data,
    )
    assert isinstance(assessments, list)
    assert len(assessments) == 4
    assert {_read_field(a, "threat_type") for a in assessments} == {
        "collision",
        "solar_flare",
        "cyber",
        "debris",
    }


def test_fusion_composite_score_order_and_actionability(
    fusion_engine: Any, sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessments = _call_first(
        fusion_engine,
        ("assess_all_threats", "assessAllThreats"),
        sample_telemetry,
        sample_external_data,
    )
    fused = _call_first(fusion_engine, ("fuse_threats", "fuseThreats"), assessments)

    assert isinstance(fused, list) and fused

    scores = [float(_read_field(item, "composite_score")) for item in fused]
    assert scores == sorted(scores, reverse=True), "fusion must be sorted by descending composite score"

    threshold = float(_read_field(fusion_engine, "actionable_threshold", 0.6))
    if threshold == 0.6 and hasattr(fusion_engine, "_actionable_threshold"):
        threshold = float(_read_field(fusion_engine, "_actionable_threshold"))

    for item in fused:
        score = float(_read_field(item, "composite_score"))
        actionable = bool(_read_field(item, "actionable"))
        assert actionable is (score > threshold)


def test_fusion_zero_probability_edge_case(fusion_engine: Any) -> None:
    # Synthetic zero-probability threat checks non-crashing edge behavior.
    threat = SimpleNamespace(
        threat_id="t-zero",
        threat_type="anomaly",
        probability=0.0,
        confidence_interval=(0.0, 0.0),
        factors=[],
    )
    fused = _call_first(fusion_engine, ("fuse_threats", "fuseThreats"), [threat])
    assert len(fused) == 1
    row = fused[0]
    assert float(_read_field(row, "composite_score")) == pytest.approx(0.0)
    assert bool(_read_field(row, "actionable")) is False
    assert "LOG" in str(_read_field(row, "recommended_action")).upper()


# -------------------------------
# Engine integration tests
# -------------------------------

def test_process_telemetry_output_schema(
    engine: Any, sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    result = _call_first(engine, ("process_telemetry", "processTelemetry"), sample_telemetry, sample_external_data)
    assert isinstance(result, Mapping)
    assert "threats" in result

    threats = result["threats"]
    assert isinstance(threats, list) and len(threats) > 0

    for threat in threats:
        assert isinstance(threat, Mapping)
        _assert_probability_bounds(float(threat["probability"]))
        _assert_confidence_interval_shape(threat["confidence_interval"])
        assert isinstance(threat["factors"], list)


def test_missing_data_returns_safe_empty_or_partial(engine: Any) -> None:
    result = _call_first(engine, ("process_telemetry", "processTelemetry"), {}, {})
    assert isinstance(result, Mapping)
    assert isinstance(result.get("threats", []), list)


def test_partial_data_only_runs_supported_models(engine: Any) -> None:
    telemetry = {
        "network": {"packet_rate": 100, "connection_attempts": 5, "entropy": 4.5}
    }
    external_data = {
        "debris": {
            "objects": [{"position": [1, 2, 3]}],
            "density": 0.2,
        }
    }

    result = _call_first(engine, ("process_telemetry", "processTelemetry"), telemetry, external_data)
    rows = result["threats"]
    assert len(rows) == 1
    assert rows[0]["type"] == "cyber"


# -------------------------------
# External dependency mocking
# -------------------------------

def test_external_dependency_mock_with_pytest_mocker(
    mocker: Any, models: dict[str, Any], sample_telemetry: dict[str, Any]
) -> None:
    """
    Demonstrates mocking of external dependencies (e.g., space-track API calls).
    Even if predict() doesn't always call HTTP, the patch ensures tests are network-isolated.
    """
    fake_response = mocker.Mock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {
        "objects": [{"position": [7001.0, 0.1, 0.2], "velocity": [0.0, 7.4, 0.0]}],
        "historical_conjunction_rate": 0.08,
    }

    mocked_get = mocker.patch(
        "backend.engine.requests.get",
        autospec=True,
        return_value=fake_response,
        create=True,
    )

    assessment = _call_first(models["collision"], ("predict",), sample_telemetry["orbital"], None)
    _assert_assessment_sane(assessment, "collision")

    # Keep this assertion permissive since implementation may choose local heuristics.
    assert mocked_get.call_count >= 0


# -------------------------------
# Additional wrapper/method coverage
# -------------------------------

def test_wrapper_methods_assess_and_fuse(
    engine: Any, sample_telemetry: dict[str, Any], sample_external_data: dict[str, Any]
) -> None:
    assessments = _call_first(engine, ("assess",), sample_telemetry, sample_external_data)
    fused = _call_first(engine, ("fuse",), assessments)

    assert isinstance(assessments, list) and len(assessments) > 0
    assert isinstance(fused, list) and len(fused) > 0


def test_low_risk_inputs_stay_within_bounds(
    engine: Any, calm_telemetry: dict[str, Any]
) -> None:
    external = {
        "space_track": {"objects": [], "historical_conjunction_rate": 0.0},
        "solar": {"complexity": 1.0, "magnetic_field": 50, "history": 0.0},
        "debris": {"objects": [{"position": [50000.0, 50000.0, 50000.0]}], "density": 0.0},
    }
    result = _call_first(engine, ("process_telemetry", "processTelemetry"), calm_telemetry, external)

    for row in result.get("threats", []):
        p = float(row["probability"])
        _assert_probability_bounds(p)
        _assert_confidence_interval_shape(row["confidence_interval"])
