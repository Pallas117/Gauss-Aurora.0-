"""Portable, vendor-neutral records for the Gauss memory fabric.

The storage engines are implementation details. Importers, exporters, model
clients, and UI tools exchange this small contract instead of depending on
SQLite, LanceDB, Granola, or a particular LLM API.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable


SCHEMA_VERSION = "gauss-memory-record-v1"
TRUTH_STATES = {"observed", "verified", "derived", "needs_review", "blocked", "superseded"}
RECORD_KINDS = {"document", "chunk", "memory", "event", "entity"}


def checksum_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _record_id(kind: str, source_type: str, external_id: str, checksum: str) -> str:
    material = f"{SCHEMA_VERSION}:{kind}:{source_type}:{external_id}:{checksum}"
    return f"record:{hashlib.sha256(material.encode('utf-8')).hexdigest()[:32]}"


def make_record(
    *,
    kind: str,
    content: str,
    source_type: str,
    external_id: str,
    source_label: str | None = None,
    observed_at: str | None = None,
    truth_state: str = "needs_review",
    confidence: float | None = None,
    provenance: Iterable[str] = (),
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized = content.strip()
    checksum = checksum_text(normalized)
    record: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "recordId": _record_id(kind, source_type, external_id, checksum),
        "kind": kind,
        "content": normalized,
        "checksum": checksum,
        "source": {"type": source_type, "externalId": external_id, "label": source_label or external_id},
        "observedAt": observed_at or _timestamp(),
        "truthState": truth_state,
        "confidence": confidence,
        "provenance": sorted({item for item in provenance if item}),
        "metadata": metadata or {},
    }
    errors = validate_record(record)
    if errors:
        raise ValueError("Invalid memory record: " + "; ".join(errors))
    return record


def validate_record(record: Any) -> list[str]:
    if not isinstance(record, dict):
        return ["record must be an object"]
    errors: list[str] = []
    if record.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION}")
    if not isinstance(record.get("recordId"), str) or not record["recordId"]:
        errors.append("recordId is required")
    if record.get("kind") not in RECORD_KINDS:
        errors.append("kind is unsupported")
    if not isinstance(record.get("content"), str) or not record["content"].strip():
        errors.append("content is required")
    if isinstance(record.get("content"), str) and record.get("checksum") != checksum_text(record["content"].strip()):
        errors.append("checksum does not match content")
    source = record.get("source")
    if not isinstance(source, dict) or not source.get("type") or not source.get("externalId"):
        errors.append("source.type and source.externalId are required")
    if record.get("truthState") not in TRUTH_STATES:
        errors.append("truthState is unsupported")
    confidence = record.get("confidence")
    if confidence is not None and (not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1):
        errors.append("confidence must be between 0 and 1")
    if not isinstance(record.get("provenance"), list) or not all(isinstance(item, str) for item in record["provenance"]):
        errors.append("provenance must be a list of strings")
    if not isinstance(record.get("metadata"), dict):
        errors.append("metadata must be an object")
    return errors


def records_to_jsonl(records: Iterable[dict[str, Any]]) -> str:
    lines: list[str] = []
    for record in records:
        errors = validate_record(record)
        if errors:
            raise ValueError("Invalid memory record: " + "; ".join(errors))
        lines.append(json.dumps(record, ensure_ascii=False, sort_keys=True))
    return "\n".join(lines) + ("\n" if lines else "")


def records_from_jsonl(payload: str, max_records: int = 256) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(payload.splitlines(), start=1):
        if not line.strip():
            continue
        if len(records) >= max_records:
            raise ValueError(f"record limit exceeded ({max_records})")
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON on line {line_number}: {exc.msg}") from exc
        errors = validate_record(record)
        if errors:
            raise ValueError(f"invalid record on line {line_number}: {'; '.join(errors)}")
        records.append(record)
    return records


def contract_description() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "recordKinds": sorted(RECORD_KINDS),
        "truthStates": sorted(TRUTH_STATES),
        "requiredFields": ["recordId", "kind", "content", "checksum", "source", "truthState", "provenance"],
        "portableFormat": "JSONL",
        "writePolicy": "unapproved records remain needs_review and are excluded from retrieval",
    }
