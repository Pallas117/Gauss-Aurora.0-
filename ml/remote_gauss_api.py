#!/usr/bin/env python3
"""
Project Gauss: FastAPI bridge for dual-agent hot-swap.
Runs the heavy hot-swap in a thread pool so the event loop is not blocked;
React HUD keeps connection and gets JSON when done. No model load on the
async thread—only the executor runs load/purge/load/purge.
"""
from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure ml/ is on path for gauss_engine / gauss_dual_agent
_ml_dir = Path(__file__).resolve().parent
if _ml_dir not in __import__("sys").path:
    __import__("sys").path.insert(0, str(_ml_dir))

from gauss_dual_agent import run_dual_agent_hot_swap

app = FastAPI(title="Gauss Remote API (Dual-Agent Hot-Swap)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One worker so we never run two hot-swaps in parallel (Apollo 6GB: one model at a time)
_executor = ThreadPoolExecutor(max_workers=1)
_job_store: dict[str, dict[str, Any]] = {}


class TriadRequest(BaseModel):
    source_path: str


class TriadResponse(BaseModel):
    ok: bool
    report: dict[str, Any] | None = None
    error: str | None = None


def _run_triad_sync(source_path: str) -> dict[str, Any]:
    """Runs in executor: load Surya -> purge -> load DeepSeek -> purge. Blocks thread, not event loop."""
    return run_dual_agent_hot_swap(source_path)


@app.post("/triad", response_model=TriadResponse)
async def triad(request: TriadRequest) -> TriadResponse:
    """
    Run dual-agent pipeline (Surya -> purge -> DeepSeek -> purge) in a thread.
    Does not block the async event loop; React HUD connection is held until result is ready.
    """
    loop = asyncio.get_running_loop()
    try:
        report = await loop.run_in_executor(_executor, _run_triad_sync, request.source_path)
        if report.get("error") == "memory_ceiling_exceeded":
            return TriadResponse(ok=False, report=None, error=report.get("message", "Memory ceiling exceeded"))
        return TriadResponse(ok=True, report=report, error=None)
    except Exception as e:
        return TriadResponse(ok=False, report=None, error=str(e))


@app.post("/triad/background", response_model=dict[str, str])
async def triad_background(request: TriadRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    """
    Queue dual-agent run in background; return immediately with job_id.
    Client can poll GET /triad/status/{job_id} or use for fire-and-forget.
    """
    job_id = os.urandom(8).hex()
    _job_store[job_id] = {"status": "running", "report": None}
    source_path = request.source_path

    def _run_and_store() -> None:
        try:
            report = _run_triad_sync(source_path)
            _job_store[job_id] = {"status": "done", "report": report}
        except Exception as e:
            _job_store[job_id] = {"status": "error", "report": None, "error": str(e)}

    # BackgroundTasks expects a sync callable; we delegate into the single-worker executor to
    # guarantee only one hot-swap is active at a time.
    def _enqueue() -> None:
        _executor.submit(_run_and_store)

    background_tasks.add_task(_enqueue)
    return {"job_id": job_id, "status": "queued"}

@app.get("/triad/status/{job_id}")
def triad_status(job_id: str) -> dict[str, Any]:
    """Poll status for a background triad run."""
    return _job_store.get(job_id, {"status": "unknown", "report": None})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn
    host = os.environ.get("GAUSS_API_HOST", "127.0.0.1")
    port = int(os.environ.get("GAUSS_API_PORT", "3010"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
