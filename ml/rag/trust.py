"""Trust manifest helpers for RAG indexing."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def default_manifest_path(root_dir: str | Path) -> Path:
    return Path(root_dir).resolve() / ".gauss-doc-trust.json"


def load_manifest(manifest_path: str | Path) -> dict[str, Any] | None:
    path = Path(manifest_path).resolve()
    if not path.is_file():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    documents = parsed.get("documents")
    if not isinstance(documents, list):
        return None
    by_path: dict[str, dict[str, Any]] = {}
    for item in documents:
        if not isinstance(item, dict):
            continue
        rel_path = item.get("path")
        if isinstance(rel_path, str) and rel_path:
            by_path[rel_path] = item
    parsed["_path"] = str(path)
    parsed["_documents_by_path"] = by_path
    return parsed


def summarize_manifest(manifest: dict[str, Any] | None) -> dict[str, Any]:
    if manifest is None:
        return {"ok": False, "manifestPath": None}
    totals = manifest.get("totals")
    return {
        "ok": True,
        "manifestPath": manifest.get("_path"),
        "totals": totals if isinstance(totals, dict) else {},
    }


def index_allowed(manifest: dict[str, Any] | None, rel_path: str) -> bool:
    if manifest is None:
        return False
    documents = manifest.get("_documents_by_path")
    if not isinstance(documents, dict):
        return False
    record = documents.get(rel_path)
    if not isinstance(record, dict):
        return False
    return record.get("indexAllowed") is True
