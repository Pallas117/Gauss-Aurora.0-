"""Adapter boundary for application and tool integrations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from ml.rag import contract


class MemoryAdapter(Protocol):
    name: str
    input_format: str

    def import_payload(self, payload: str) -> list[dict[str, Any]]:
        ...

    def export_payload(self, records: list[dict[str, Any]]) -> str:
        ...


@dataclass(frozen=True)
class JsonlMemoryAdapter:
    name: str = "jsonl"
    input_format: str = "application/x-ndjson"

    def import_payload(self, payload: str) -> list[dict[str, Any]]:
        return contract.records_from_jsonl(payload)

    def export_payload(self, records: list[dict[str, Any]]) -> str:
        return contract.records_to_jsonl(records)


def default_adapters() -> list[dict[str, str]]:
    adapter = JsonlMemoryAdapter()
    return [{"name": adapter.name, "inputFormat": adapter.input_format, "role": "portable memory exchange"}]
