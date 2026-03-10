"""Integration tests for FastAPI threat API endpoints."""

from __future__ import annotations

from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.integration
def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.integration
def test_threat_evaluation_endpoint_returns_frontend_ready_schema(
    client: TestClient,
    sample_telemetry: Dict[str, Any],
    sample_external_data: Dict[str, Any],
) -> None:
    response = client.post(
        "/api/threats/evaluate",
        json={
            "telemetry": sample_telemetry,
            "external_data": sample_external_data,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "threats" in payload
    threats = payload["threats"]
    assert isinstance(threats, list)
    assert len(threats) >= 1

    for row in threats:
        assert isinstance(row["id"], str)
        assert isinstance(row["type"], str)
        assert 0.0 <= float(row["probability"]) <= 1.0
        assert 0.0 <= float(row["composite_score"]) <= 1.0
        ci = row["confidence_interval"]
        assert isinstance(ci, list) and len(ci) == 2
        assert 0.0 <= ci[0] <= ci[1] <= 1.0
        assert isinstance(row["factors"], list)

    composites = [float(row["composite_score"]) for row in threats]
    assert composites == sorted(composites, reverse=True)


@pytest.mark.integration
def test_threat_evaluation_rejects_non_object_payload(client: TestClient) -> None:
    response = client.post("/api/threats/evaluate", json=["invalid"])
    assert response.status_code == 422
