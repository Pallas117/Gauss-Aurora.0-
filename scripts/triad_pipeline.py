#!/usr/bin/env python3
"""
Triad pipeline: Worker A (Surya) -> GC -> Worker B (DeepSeek) -> GC -> report JSON on stdout.
Runs entirely via direct API where possible; minimal deps. No n8n or external automation.
Apollo-style: one model in memory at a time; aggressive GC between stages (6GB M1 ceiling).
"""
from __future__ import annotations

import gc
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

def _gc_and_clear():
    """Apollo 6GB: strict order — gc, then Torch MPS/CUDA, then MLX Metal. Reclaims 50–200+ MB between agents."""
    gc.collect()
    try:
        if "torch" in sys.modules:
            import torch  # noqa: F401
            if hasattr(torch, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()  # M1: ~50–150 MB after Surya unload
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    except (ImportError, Exception):
        pass
    try:
        if "mlx" in sys.modules or "mlx.core" in sys.modules:
            import mlx.core as mx  # noqa: F401
            mx.metal.clear_cache()  # M1: ~100–500 MB after DeepSeek unload
    except (ImportError, Exception):
        pass
    gc.collect()

def run_surya_stub(csv_path: str) -> dict:
    """Worker A: Surya physics forecast. Calls SURYA_SERVICE_URL when set; else stub."""
    _gc_and_clear()
    try:
        surya_url = (os.environ.get("SURYA_SERVICE_URL") or "").rstrip("/")
        if surya_url:
            import urllib.request
            import urllib.error
            url = f"{surya_url}/surya/forecast"
            body = json.dumps({}).encode("utf-8")
            req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode())
                path = Path(csv_path)
                size = path.stat().st_size if path.exists() else 0
                return {
                    "worker": "surya",
                    "model": data.get("model", "surya.366m.v1"),
                    "forecast": data.get("forecast", [{"time": "now", "value": 0.0}]),
                    "source_path": csv_path,
                    "source_size_bytes": size,
                    "stub": False,
                }
            except (urllib.error.URLError, OSError, json.JSONDecodeError):
                pass
        path = Path(csv_path)
        size = path.stat().st_size if path.exists() else 0
        return {
            "worker": "surya",
            "model": "surya.366m.v1",
            "forecast": [{"time": "now", "value": 0.0}],
            "source_path": csv_path,
            "source_size_bytes": size,
            "stub": True,
        }
    finally:
        _gc_and_clear()


def run_deepseek_via_api(csv_path: str, surya_output: dict) -> dict:
    """Worker B: DeepSeek CoT reasoning. Calls local engine (GAUSS_BRAIN_URL) if set."""
    _gc_and_clear()
    import urllib.request
    import urllib.error

    url = (os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_URL") or os.environ.get("GAUSS_BRAIN_URL") or "").rstrip("/")
    if not url:
        url = "http://127.0.0.1:8089/v1/chat/completions"
    elif not url.endswith("/v1/chat/completions"):
        url = f"{url}/v1/chat/completions"

    prompt = f"""You are the Gauss space-ops co-pilot. Your recommendation must follow spacecraft operations norms and probability-based reasoning: use only NOMINAL, MONITOR, or INITIATE SHIELDING, with a brief rationale. Reason ethically: prioritize crew and asset safety; treat Earth and its fields as one system; state uncertainty when present; be transparent; align with equitable, sustainable, data-backed outcomes. Communicate in a calm, precise, mission-focused voice; you are a partner to the human operator in a system built to save lives and enable an equitable, sustainable space future. Base your answer on the physics/telemetry context below.

Context: {json.dumps(surya_output)[:500]}
CSV path: {csv_path}

Provide a brief mission assessment (2-4 sentences). Output: one of NOMINAL / MONITOR / INITIATE SHIELDING and one-line rationale. When uncertain, say so and suggest what would clarify (e.g. additional telemetry or time window)."""

    body = json.dumps({
        "model": os.environ.get("ORCHESTRATOR_CHAT_MODEL", "local-model"),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            return {
                "worker": "deepseek",
                "recommendation": content[:200],
                "reasoning": content,
                "stub": False,
            }
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        return {
            "worker": "deepseek",
            "recommendation": "UNAVAILABLE (local engine not reachable)",
            "reasoning": str(e),
            "stub": True,
        }
    finally:
        _gc_and_clear()


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: triad_pipeline.py <source_path>"}), file=sys.stderr)
        sys.exit(1)
    csv_path = sys.argv[1]

    surya_out = run_surya_stub(csv_path)
    deepseek_out = run_deepseek_via_api(csv_path, surya_out)

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "surya": surya_out,
        "deepseek": deepseek_out,
        "summary": deepseek_out.get("recommendation", ""),
    }
    print(json.dumps(report))


if __name__ == "__main__":
    main()
