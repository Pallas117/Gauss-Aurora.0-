"""FastAPI integration surface for SpaceProbabilityEngine + PowerSync sync."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI
from pydantic import BaseModel, Field

from backend.engine import SpaceProbabilityEngine


class EvaluateRequest(BaseModel):
    telemetry: Dict[str, Any] = Field(default_factory=dict)
    external_data: Dict[str, Any] = Field(default_factory=dict)


class PowerSyncSyncRequest(BaseModel):
    records: List[Dict[str, Any]] = Field(default_factory=list)
    run_id: Optional[str] = None


class PacketQualityFlags(BaseModel):
    crc_checked: bool = False
    crc_valid: Optional[bool] = None
    missing_parameters: bool = False


class PacketRecord(BaseModel):
    timestamp: str
    apid: int
    seq_count: int
    payload_hex: str
    canonical_point: Dict[str, Any]
    quality_flags: PacketQualityFlags = Field(default_factory=PacketQualityFlags)
    uncertainty: Dict[str, Any] = Field(default_factory=dict)


class PacketIngestRequest(BaseModel):
    run_id: str
    source: str = "ccsds-orchestrator"
    format: str = Field(pattern="^(ccsds-bin|ccsds-hex)$")
    dictionary_id: str
    packets: List[PacketRecord] = Field(default_factory=list)


@dataclass
class InMemoryPowerSyncAdapter:
    pushes: int = 0
    records_synced: int = 0

    def push(self, records: List[Dict[str, Any]], run_id: Optional[str] = None) -> Dict[str, Any]:
        self.pushes += 1
        self.records_synced += len(records)
        return {
            "status": "ok",
            "synced": len(records),
            "run_id": run_id,
            "pushes": self.pushes,
            "total_synced": self.records_synced,
        }


@dataclass
class InMemoryPacketIngestAdapter:
    writes: int = 0
    accepted_total: int = 0
    rejected_total: int = 0

    def ingest(self, packets: List[PacketRecord]) -> Dict[str, Any]:
        errors: List[Dict[str, Any]] = []
        accepted = 0
        for index, packet in enumerate(packets):
            try:
                speed = float(packet.canonical_point.get("solarWind", {}).get("speed"))
                density = float(packet.canonical_point.get("solarWind", {}).get("density"))
                bz = float(packet.canonical_point.get("magneticField", {}).get("z"))
                if not all(map(lambda x: x == x and x not in (float("inf"), float("-inf")), [speed, density, bz])):
                    raise ValueError("non-finite canonical field")
                accepted += 1
            except Exception:
                errors.append(
                    {
                        "index": index,
                        "code": "invalid_canonical_point",
                        "reason": "canonical_point is missing required finite fields",
                    }
                )

        rejected = len(packets) - accepted
        self.writes += 1
        self.accepted_total += accepted
        self.rejected_total += rejected
        return {
            "accepted_count": accepted,
            "rejected_count": rejected,
            "errors": errors,
        }


app = FastAPI(title="Gauss Threat API", version="0.1.0")
_engine = SpaceProbabilityEngine()
_powersync_adapter = InMemoryPowerSyncAdapter()
_packet_adapter = InMemoryPacketIngestAdapter()


def get_engine() -> SpaceProbabilityEngine:
    return _engine


def get_powersync_adapter() -> InMemoryPowerSyncAdapter:
    return _powersync_adapter


def get_packet_ingest_adapter() -> InMemoryPacketIngestAdapter:
    return _packet_adapter


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/threats/evaluate")
def evaluate_threats(
    payload: EvaluateRequest,
    engine: SpaceProbabilityEngine = Depends(get_engine),
) -> Dict[str, Any]:
    return engine.process_telemetry(payload.telemetry, payload.external_data)


@app.post("/api/powersync/sync")
def powersync_sync(
    payload: PowerSyncSyncRequest,
    adapter: InMemoryPowerSyncAdapter = Depends(get_powersync_adapter),
) -> Dict[str, Any]:
    return adapter.push(payload.records, payload.run_id)


@app.get("/api/powersync/health")
def powersync_health(
    adapter: InMemoryPowerSyncAdapter = Depends(get_powersync_adapter),
) -> Dict[str, Any]:
    return {
        "status": "ok",
        "pushes": adapter.pushes,
        "records_synced": adapter.records_synced,
    }


@app.post("/api/ingest/telemetry/packets")
def ingest_telemetry_packets(
    payload: PacketIngestRequest,
    adapter: InMemoryPacketIngestAdapter = Depends(get_packet_ingest_adapter),
) -> Dict[str, Any]:
    return adapter.ingest(payload.packets)
