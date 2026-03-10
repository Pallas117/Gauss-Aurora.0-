"""Integration tests for PowerSync sync endpoint behavior."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app, get_powersync_adapter


@dataclass
class StubPowerSyncAdapter:
    calls: int = 0
    last_records: List[Dict[str, Any]] | None = None
    last_run_id: str | None = None

    def push(self, records: List[Dict[str, Any]], run_id: str | None = None) -> Dict[str, Any]:
        self.calls += 1
        self.last_records = list(records)
        self.last_run_id = run_id
        return {
            "status": "ok",
            "synced": len(records),
            "run_id": run_id,
            "calls": self.calls,
        }


@pytest.fixture
def client_with_stub_adapter() -> tuple[TestClient, StubPowerSyncAdapter]:
    stub = StubPowerSyncAdapter()

    def _override() -> StubPowerSyncAdapter:
        return stub

    app.dependency_overrides[get_powersync_adapter] = _override
    client = TestClient(app)
    try:
        yield client, stub
    finally:
        app.dependency_overrides.pop(get_powersync_adapter, None)


@pytest.mark.integration
def test_powersync_sync_pushes_records(client_with_stub_adapter: tuple[TestClient, StubPowerSyncAdapter]) -> None:
    client, stub = client_with_stub_adapter
    response = client.post(
        "/api/powersync/sync",
        json={
            "run_id": "it-sync-001",
            "records": [
                {"entity": "space_weather_point", "id": "sw-1", "value": 0.42},
                {"entity": "threat", "id": "th-1", "value": 0.88},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["synced"] == 2
    assert payload["run_id"] == "it-sync-001"

    assert stub.calls == 1
    assert stub.last_run_id == "it-sync-001"
    assert stub.last_records is not None
    assert len(stub.last_records) == 2


@pytest.mark.integration
def test_powersync_sync_allows_empty_batch(client_with_stub_adapter: tuple[TestClient, StubPowerSyncAdapter]) -> None:
    client, stub = client_with_stub_adapter
    response = client.post(
        "/api/powersync/sync",
        json={"run_id": "it-sync-empty", "records": []},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["synced"] == 0

    assert stub.calls == 1
    assert stub.last_records == []


@pytest.mark.integration
def test_powersync_sync_rejects_invalid_record_shape(client_with_stub_adapter: tuple[TestClient, StubPowerSyncAdapter]) -> None:
    client, _ = client_with_stub_adapter
    response = client.post(
        "/api/powersync/sync",
        json={"run_id": "it-sync-invalid", "records": ["bad-row"]},
    )
    assert response.status_code == 422
