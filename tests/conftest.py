from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pytest

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@lru_cache(maxsize=16)
def _load_fixture_file(filename: str) -> dict[str, Any]:
    path = FIXTURES_DIR / filename
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def sample_orbital_state() -> dict[str, Any]:
    return dict(_load_fixture_file("sample_orbital_state.json"))


@pytest.fixture
def sample_solar_data() -> dict[str, Any]:
    return dict(_load_fixture_file("sample_solar_data.json"))


@pytest.fixture
def sample_network_flows() -> dict[str, Any]:
    return dict(_load_fixture_file("sample_network_flows.json"))


@pytest.fixture
def sample_debris_catalogue() -> dict[str, Any]:
    data = dict(_load_fixture_file("sample_debris_catalogue.json"))
    data["objects"] = [dict(obj) for obj in data.get("objects", [])]
    return data


@pytest.fixture
def sample_telemetry(
    sample_orbital_state: dict[str, Any],
    sample_network_flows: dict[str, Any],
) -> dict[str, Any]:
    return {
        "orbital": dict(sample_orbital_state),
        "network": dict(sample_network_flows),
    }


@pytest.fixture
def sample_external_data(
    sample_solar_data: dict[str, Any],
    sample_debris_catalogue: dict[str, Any],
) -> dict[str, Any]:
    return {
        "space_track": {
            "objects": [
                {"position": [7012.0, 0.6, -0.8], "velocity": [0.0, 7.2, 0.0]},
                {"position": [6988.0, -1.4, 1.1], "velocity": [0.0, 7.8, 0.0]},
            ],
            "historical_conjunction_rate": 0.12,
        },
        "solar": dict(sample_solar_data),
        "debris": dict(sample_debris_catalogue),
    }
