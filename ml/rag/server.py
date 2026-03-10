#!/usr/bin/env python3
"""Gauss RAG service: GET /api/rag/status, POST /api/rag/index, POST /api/rag/query. LanceDB + checksums."""
from __future__ import annotations

import gc
import os
import json
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import after path is set
from ml.rag import ingest, embed, store, trust

app = FastAPI(title="Gauss RAG")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IndexBody(BaseModel):
    dir: str = ""
    manifest_path: str = ""
    require_approved: bool = True


class QueryBody(BaseModel):
    query: str = ""


def _debug_log(_key: str, _title: str, _payload: dict, _level: str = "H5") -> None:
    """No-op debug logger; set GAUSS_RAG_DEBUG=1 to enable if implemented."""
    pass


def _chat_completions_url() -> str | None:
    base = (
        os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_URL")
        or os.environ.get("GAUSS_BRAIN_URL")
        or ""
    ).strip()
    if not base:
        return None
    base = base.rstrip("/")
    if base.endswith("/v1/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _extract_llm_answer(payload: dict) -> str | None:
    choices = payload.get("choices") or []
    if isinstance(choices, list) and choices:
        first = choices[0] or {}
        if isinstance(first, dict):
            msg = first.get("message") or {}
            if isinstance(msg, dict):
                for field in ("content", "reasoning"):
                    value = msg.get(field)
                    if isinstance(value, str) and value.strip():
                        return value.strip()
    for field in ("response", "output", "text", "message"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _resolve_dir(dir_path: str) -> Path:
    p = Path(dir_path)
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


@app.get("/api/rag/status")
def rag_status():
    db = store.open_db()
    store.create_table_if_missing(db)
    count = 0
    if store.TABLE_NAME in db.table_names():
        t = db.open_table(store.TABLE_NAME)
        count = t.count_rows()
    default_root = _resolve_dir("research/documentation-rag")
    manifest = trust.load_manifest(trust.default_manifest_path(default_root))
    return {"ok": True, "chunkCount": count, "trustManifest": trust.summarize_manifest(manifest)}


@app.post("/api/rag/index")
def rag_index(body: IndexBody):
    dir_path = _resolve_dir(body.dir or "research/documentation-rag")
    if not dir_path.is_dir():
        return {"ok": False, "error": f"Directory not found: {dir_path}"}
    manifest_path = _resolve_dir(body.manifest_path) if body.manifest_path else trust.default_manifest_path(dir_path)
    manifest = trust.load_manifest(manifest_path)
    if body.require_approved and manifest is None:
        return {
            "ok": False,
            "error": (
                f"Trust manifest not found: {manifest_path}. "
                "Run `npm run audit:documents:trust` before indexing, or set require_approved=false for an explicit bypass."
            ),
        }
    db = store.open_db()
    store.create_table_if_missing(db)
    store.clear_table(db)
    batch_size = 16
    texts_batch = []
    paths_batch = []
    ids_batch = []
    checksums_batch = []
    total = 0
    indexed_docs = set()
    for fp, chunk, cid in ingest.iter_doc_chunks(
        dir_path,
        max_tokens=512,
        overlap_tokens=128,
        manifest_path=manifest_path,
        require_approved=body.require_approved,
    ):
        checksum = ingest.checksum_text(chunk)
        texts_batch.append(chunk)
        paths_batch.append(fp)
        ids_batch.append(cid)
        checksums_batch.append(checksum)
        indexed_docs.add(fp)
        if len(texts_batch) >= batch_size:
            vecs = embed.embed_texts(texts_batch)
            store.add_chunks(db, vecs, texts_batch, paths_batch, ids_batch, checksums_batch)
            total += len(texts_batch)
            texts_batch = []
            paths_batch = []
            ids_batch = []
            checksums_batch = []
            gc.collect()
    if texts_batch:
        vecs = embed.embed_texts(texts_batch)
        store.add_chunks(db, vecs, texts_batch, paths_batch, ids_batch, checksums_batch)
        total += len(texts_batch)
    gc.collect()
    return {
        "ok": True,
        "chunkCount": total,
        "indexedDocumentCount": len(indexed_docs),
        "manifestPath": str(manifest_path) if manifest is not None else None,
    }


@app.post("/api/rag/query")
def rag_query(body: QueryBody):
    q = (body.query or "").strip()
    if not q:
        return {"ok": True, "answer": "No query provided.", "sources": []}
    db = store.open_db()
    store.create_table_if_missing(db)
    if store.TABLE_NAME not in db.table_names():
        return {"ok": True, "answer": "Index is empty. Run Index first.", "sources": []}
    query_vec = embed.embed_query(q)
    hits = store.search(db, query_vec, top_k=8)
    verified = []
    context_parts = []
    for h in hits:
        text = h.get("text") or ""
        stored_cs = h.get("checksum") or ""
        if ingest.checksum_text(text) != stored_cs:
            continue
        verified.append({"filePath": h.get("file_path") or "", "score": float(h.get("_distance", 0))})
        context_parts.append(text)
    context = "\n\n---\n\n".join(context_parts[:5])
    answer = "No local LLM configured or no verified context."
    url = _chat_completions_url()
    if url and context:
        system_instruction = (
            "You are the Gauss space-ops co-pilot. Use spacecraft operations procedures and "
            "probability-based threat assessment when answering: cite confidence intervals, "
            "3-sigma gating, and fusion norms where relevant. Reason ethically: prioritize crew and asset safety; "
            "treat Earth and its fields as one system; preserve the orbital commons through restraint, reversibility, and non-destructive alternatives; "
            "state uncertainty when present; be transparent; align with equitable, sustainable, data-backed outcomes. Communicate in a calm, precise, mission-focused voice; "
            "you are a partner to the human operator in a system built to save lives and enable an equitable, sustainable space future. "
            "If the context does not contain relevant information, say so."
        )
        prompt = f"{system_instruction}\n\nUse the following context to answer the question.\n\nContext:\n{context}\n\nQuestion: {q}\n\nAnswer:"
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_API_KEY", "").strip()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            with httpx.Client(timeout=60.0) as client:
                r = client.post(
                    url,
                    json={
                        "model": os.environ.get("ORCHESTRATOR_CHAT_MODEL", "local-model"),
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    headers=headers,
                )
                _debug_log("server.py:rag_query:llm_response", "LLM response", {"status_code": r.status_code}, "H4")
                if r.status_code == 200:
                    data = r.json()
                    extracted = _extract_llm_answer(data)
                    if extracted:
                        answer = extracted
        except Exception as e:
            _debug_log("server.py:rag_query:llm_exception", "LLM exception", {"err": str(e)[:150]}, "H4")
            answer = f"LLM request failed: {e}. Context was verified and retrieved."
    elif context:
        answer = "(Local LLM not set; set ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL.) Retrieved context is verified."
    _debug_log("server.py:rag_query:return", "response", {"answer_len": len(answer), "sources_count": len(verified)}, "H5")
    return {"ok": True, "answer": answer, "sources": verified}


def main():
    port = int(os.environ.get("GAUSS_RAG_PORT", "3002"))
    host = os.environ.get("GAUSS_RAG_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
