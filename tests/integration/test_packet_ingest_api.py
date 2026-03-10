"""Integration tests for packet ingest API contract in FastAPI auxiliary surface."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.integration
def test_packet_ingest_accepts_valid_payload(client: TestClient) -> None:
    response = client.post(
        "/api/ingest/telemetry/packets",
        json={
            "run_id": "run-123",
            "source": "ccsds-orchestrator",
            "format": "ccsds-bin",
            "dictionary_id": "gauss-baseline-v1",
            "packets": [
                {
                    "timestamp": "2026-02-23T00:00:00Z",
                    "apid": 900,
                    "seq_count": 12,
                    "payload_hex": "43E1400040E66666C0466666",
                    "canonical_point": {
                        "timestamp": "2026-02-23T00:00:00Z",
                        "solarWind": {"speed": 450.5, "density": 7.2},
                        "magneticField": {"z": -3.1},
                    },
                    "quality_flags": {"crc_checked": False, "crc_valid": None, "missing_parameters": False},
                    "uncertainty": {"speed": {"sigma": 8}},
                }
            ],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted_count"] == 1
    assert payload["rejected_count"] == 0
    assert payload["errors"] == []


@pytest.mark.integration
def test_packet_ingest_marks_invalid_canonical_point(client: TestClient) -> None:
    response = client.post(
        "/api/ingest/telemetry/packets",
        json={
            "run_id": "run-124",
            "source": "ccsds-orchestrator",
            "format": "ccsds-hex",
            "dictionary_id": "gauss-baseline-v1",
            "packets": [
                {
                    "timestamp": "2026-02-23T00:00:00Z",
                    "apid": 900,
                    "seq_count": 13,
                    "payload_hex": "43E1400040E66666C0466666",
                    "canonical_point": {
                        "timestamp": "2026-02-23T00:00:00Z",
                        "solarWind": {"speed": "bad", "density": 7.2},
                        "magneticField": {"z": -3.1},
                    },
                    "quality_flags": {"crc_checked": False, "crc_valid": None, "missing_parameters": False},
                    "uncertainty": {},
                }
            ],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted_count"] == 0
    assert payload["rejected_count"] == 1
    assert payload["errors"][0]["code"] == "invalid_canonical_point"
