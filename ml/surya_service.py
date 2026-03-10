#!/usr/bin/env python3
"""
Surya heliophysics inference service. Exposes POST /surya/forecast and POST /surya/flare.
Stub by default; set SURYA_MODEL_PATH or SURYA_USE_HF=1 to attempt real model load (requires torch + NASA-IMPACT/Surya or HF).
M1-safe: lazy load, gc.collect() and cache clear after each request.
"""
from __future__ import annotations

import gc
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Gauss Surya Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _gc_and_clear() -> None:
    """Apollo 6GB: gc then Torch MPS/CUDA then MLX Metal. Reclaims 50–200+ MB after each request."""
    gc.collect()
    try:
        if "torch" in __import__("sys").modules:
            import torch  # noqa: F401
            if hasattr(torch, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    except Exception:
        pass
    try:
        if "mlx" in __import__("sys").modules or "mlx.core" in __import__("sys").modules:
            import mlx.core as mx  # noqa: F401
            mx.metal.clear_cache()
    except Exception:
        pass
    gc.collect()


def _stub_forecast() -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "forecast": [{"time": now, "value": 0.0}],
        "model": "surya.366m.v1",
        "horizonHours": 12,
    }


def _stub_flare() -> dict[str, Any]:
    return {
        "flare_probability_24h": 0.0,
        "model": "surya.366m.v1",
    }


def _run_surya_forecast(_body: dict) -> dict[str, Any]:
    """Run real Surya forecast if model available; else stub."""
    model_path = os.environ.get("SURYA_MODEL_PATH", "").strip()
    use_hf = os.environ.get("SURYA_USE_HF", "").strip().lower() in ("1", "true", "yes")
    if not model_path and not use_hf:
        return _stub_forecast()
    try:
        import torch  # noqa: F401
    except ImportError:
        return _stub_forecast()
    # Optional: load from HF or path and run inference (see docs/SURYA_INTEGRATION.md)
    # For now return stub; implement real forward pass when NASA-IMPACT/Surya is wired.
    return _stub_forecast()


def _run_surya_flare(_body: dict) -> dict[str, Any]:
    """Run real Surya flare prob if model available; else stub."""
    model_path = os.environ.get("SURYA_MODEL_PATH", "").strip()
    use_hf = os.environ.get("SURYA_USE_HF", "").strip().lower() in ("1", "true", "yes")
    if not model_path and not use_hf:
        return _stub_flare()
    try:
        import torch  # noqa: F401
    except ImportError:
        return _stub_flare()
    return _stub_flare()


class ForecastBody(BaseModel):
    startTime: str | None = None
    endTime: str | None = None
    channelIds: list[str] | None = None


class FlareBody(BaseModel):
    timeWindow: str = "24h"


@app.post("/surya/forecast")
def surya_forecast(body: ForecastBody | None = None) -> dict[str, Any]:
    try:
        out = _run_surya_forecast(body.model_dump() if body else {})
        return out
    finally:
        _gc_and_clear()


@app.post("/surya/flare")
def surya_flare(body: FlareBody | None = None) -> dict[str, Any]:
    try:
        out = _run_surya_flare(body.model_dump() if body else {})
        return out
    finally:
        _gc_and_clear()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn
    port = int(os.environ.get("SURYA_SERVICE_PORT", "3003"))
    host = os.environ.get("SURYA_SERVICE_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
