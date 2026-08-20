#!/usr/bin/env python3
"""Local Gauss memory/RAG service with hybrid retrieval and graph provenance."""
from __future__ import annotations

import gc
import os
from pathlib import Path
from urllib.parse import urlparse

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ml.rag import adapters, contract, embed, ingest, memory, store, trust

app = FastAPI(title="Gauss Hybrid Memory")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_catalog: memory.MemoryCatalog | None = None


class IndexBody(BaseModel):
    dir: str = ""
    manifest_path: str = ""
    require_approved: bool = True
    mode: str = "incremental"


class QueryBody(BaseModel):
    query: str = ""
    top_k: int = 8


class RememberBody(BaseModel):
    title: str = ""
    content: str = ""
    source: str = "operator"
    approved: bool = False


class CompactBody(BaseModel):
    title: str = "Session compaction"
    content: str = ""
    source: str = "session"


class ForgetBody(BaseModel):
    id: str = ""


class ImportBody(BaseModel):
    records: list[dict] = []
    jsonl: str = ""
    approved: bool = False


def _get_catalog() -> memory.MemoryCatalog:
    global _catalog
    if _catalog is None:
        _catalog = memory.MemoryCatalog()
    return _catalog


def _is_truthy(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _air_gap_enabled() -> bool:
    return _is_truthy(os.environ.get("GAUSS_AIR_GAP", "1"))


def _allow_tailscale() -> bool:
    return _is_truthy(os.environ.get("GAUSS_ALLOW_TAILSCALE"))


def _is_allowed_host(hostname: str | None) -> bool:
    if not hostname:
        return False
    if hostname in {"127.0.0.1", "localhost"}:
        return True
    if _air_gap_enabled():
        return False
    return _allow_tailscale() and hostname.startswith("100.")


def _ensure_allowed_endpoint(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported endpoint scheme for RAG bridge: {parsed.scheme}")
    if not _is_allowed_host(parsed.hostname):
        raise ValueError(f"Blocked endpoint host for offline policy: {parsed.hostname or 'unknown'}")


def _allowed_index_roots() -> list[Path]:
    env_value = (os.environ.get("GAUSS_RAG_ALLOWED_ROOTS") or "").strip()
    raw_roots = [part.strip() for part in env_value.split(",") if part.strip()]
    if not raw_roots:
        raw_roots = [
            "research/documentation-rag",
            "research/memory-inbox",
            "reports/lessons",
            "reports/rag",
            "reports/monitoring",
            "reports/network",
            "reports/presentation",
        ]
    roots: list[Path] = []
    for root in raw_roots:
        p = Path(root)
        roots.append((p if p.is_absolute() else Path.cwd() / p).resolve())
    return roots


def _is_within_allowed_roots(candidate: Path) -> bool:
    return any(candidate == root or root in candidate.parents for root in _allowed_index_roots())


def _debug_log(_key: str, _title: str, _payload: dict, _level: str = "H5") -> None:
    pass


def _chat_completions_url() -> str | None:
    base = (os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_URL") or os.environ.get("GAUSS_BRAIN_URL") or "").strip()
    if not base:
        return None
    base = base.rstrip("/")
    url = base if base.endswith("/v1/chat/completions") else f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
    _ensure_allowed_endpoint(url)
    return url


def _extract_llm_answer(payload: dict) -> str | None:
    choices = payload.get("choices") or []
    if isinstance(choices, list) and choices:
        message = (choices[0] or {}).get("message") or {}
        if isinstance(message, dict):
            for field in ("content", "reasoning"):
                value = message.get(field)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    for field in ("response", "output", "text", "message"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _resolve_dir(dir_path: str) -> Path:
    p = Path(dir_path)
    resolved = (p if p.is_absolute() else Path.cwd() / p).resolve()
    if not _is_within_allowed_roots(resolved):
        raise ValueError(f"Directory outside approved RAG roots: {resolved}. Configure GAUSS_RAG_ALLOWED_ROOTS if needed.")
    return resolved


def _resolve_manifest(dir_path: Path, manifest_path: str) -> Path:
    candidate = manifest_path or str(trust.default_manifest_path(dir_path))
    return _resolve_dir(candidate)


def _index(body: IndexBody) -> dict:
    try:
        dir_path = _resolve_dir(body.dir or "research/documentation-rag")
        manifest_path = _resolve_manifest(dir_path, body.manifest_path)
    except Exception as err:
        return {"ok": False, "error": str(err)}
    if not dir_path.is_dir():
        return {"ok": False, "error": f"Directory not found: {dir_path}"}
    manifest = trust.load_manifest(manifest_path)
    if body.require_approved and manifest is None:
        return {"ok": False, "error": f"Trust manifest not found: {manifest_path}. Run `npm run audit:documents:trust` first."}
    result = _get_catalog().index_root(dir_path, manifest_path, body.require_approved, body.mode if body.mode in {"incremental", "rebuild"} else "incremental")
    result["manifestPath"] = str(manifest_path) if manifest is not None else None
    gc.collect()
    return result


def _query_memory(query: str, top_k: int = 8) -> dict:
    q = query.strip()
    if not q:
        return {"ok": True, "answer": "No query provided.", "sources": [], "results": [], "graph": _get_catalog().graph()}
    vector = None
    try:
        vector = embed.embed_query(q)
    except Exception:
        pass
    result = _get_catalog().search(q, vector, top_k=max(1, min(top_k, 50)))
    context_parts: list[str] = []
    verified: list[dict] = []
    for hit in result.get("results", []):
        text = hit.get("text") or ""
        stored_cs = hit.get("checksum") or ""
        if ingest.checksum_text(text) != stored_cs:
            continue
        verified.append({
            "filePath": hit.get("filePath") or "",
            "chunkId": hit.get("chunkId") or "",
            "score": float(hit.get("score", 0.0)),
            "sourceSha256": hit.get("sourceSha256"),
            "verified": True,
        })
        context_parts.append(text)
    context = "\n\n---\n\n".join(context_parts[:5])
    answer = "No local LLM configured or no verified context."
    try:
        url = _chat_completions_url()
    except Exception as err:
        url = None
        answer = f"LLM endpoint blocked by offline policy: {err}"
    if url and context:
        system_instruction = (
            "You are the Gauss space-ops co-pilot. Use only the verified context, cite source paths, "
            "state uncertainty, and never upgrade unknown or blocked evidence. Preserve the orbital commons "
            "through restraint, reversibility, and non-destructive alternatives."
        )
        prompt = f"{system_instruction}\n\nContext:\n{context}\n\nQuestion: {q}\n\nAnswer:"
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_API_KEY", "").strip()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(url, json={"model": os.environ.get("ORCHESTRATOR_CHAT_MODEL", "local-model"), "messages": [{"role": "user", "content": prompt}]}, headers=headers)
                if response.status_code == 200:
                    extracted = _extract_llm_answer(response.json())
                    if extracted:
                        answer = extracted
        except Exception as err:
            answer = f"LLM request failed: {err}. Context was verified and retrieved."
    elif context:
        answer = "(Local LLM not set.) Retrieved context is verified."
    return {**result, "answer": answer, "sources": verified}


@app.get("/api/memory/status")
def memory_status():
    return _get_catalog().status()


@app.post("/api/memory/index")
def memory_index(body: IndexBody):
    return _index(body)


@app.post("/api/memory/search")
def memory_search(body: QueryBody):
    return _query_memory(body.query, body.top_k)


@app.post("/api/memory/recall")
def memory_recall(body: QueryBody):
    return _query_memory(body.query, body.top_k)


@app.get("/api/memory/graph")
def memory_graph(
    focus: str | None = None,
    depth: int = 1,
    kind: str | None = None,
    source: str | None = None,
    max_nodes: int = memory.MAX_GRAPH_NODES,
    max_edges: int = memory.MAX_GRAPH_EDGES,
):
    return _get_catalog().graph(focus, depth, kind, source, max_nodes, max_edges)


@app.post("/api/memory/remember")
def memory_remember(body: RememberBody):
    return _get_catalog().remember(body.title, body.content, body.source, body.approved)


@app.post("/api/memory/compact")
def memory_compact(body: CompactBody):
    return _get_catalog().compact(body.title, body.content, body.source)


@app.post("/api/memory/forget")
def memory_forget(body: ForgetBody):
    return _get_catalog().forget(body.id)


@app.get("/api/memory/capabilities")
def memory_capabilities():
    return {"ok": True, "contract": contract.contract_description(), "adapters": adapters.default_adapters(), "storage": {"canonical": "SQLite/FTS5", "semantic": "LanceDB", "graph": "SQLite relations"}}


@app.get("/api/memory/export")
def memory_export(query: str = "", limit: int = 64, approved_only: bool = True):
    records = _get_catalog().export_records(query=query, limit=limit, approved_only=approved_only)
    adapter = adapters.JsonlMemoryAdapter()
    return {"ok": True, "contract": contract.contract_description(), "count": len(records), "records": records, "jsonl": adapter.export_payload(records)}


@app.post("/api/memory/import")
def memory_import(body: ImportBody):
    try:
        records = list(body.records)
        if body.jsonl.strip():
            records.extend(adapters.JsonlMemoryAdapter().import_payload(body.jsonl))
        return _get_catalog().import_records(records, approved=body.approved)
    except ValueError as err:
        return {"ok": False, "imported": 0, "pendingReview": 0, "errors": [str(err)]}


@app.get("/api/rag/status")
def rag_status():
    payload = _get_catalog().status()
    try:
        default_root = _resolve_dir("research/documentation-rag")
        manifest = trust.load_manifest(trust.default_manifest_path(default_root))
        payload["trustManifest"] = trust.summarize_manifest(manifest)
    except Exception as err:
        payload["trustManifest"] = {"error": str(err)}
    payload["chunkCount"] = payload["chunks"]
    return payload


@app.post("/api/rag/index")
def rag_index(body: IndexBody):
    return _index(body)


@app.post("/api/rag/query")
def rag_query(body: QueryBody):
    return _query_memory(body.query, body.top_k)


def main():
    port = int(os.environ.get("GAUSS_RAG_PORT", "3002"))
    host = os.environ.get("GAUSS_RAG_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
