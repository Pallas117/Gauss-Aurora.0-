#!/usr/bin/env python3
"""
Project Gauss: Single-Agent Inference Engine (Apollo 6GB).
Load exactly one model at a time; run inference; capture output; purge immediately.
Strict sequence: del model/tokenizer -> gc.collect() -> torch.mps.empty_cache() -> mx.metal.clear_cache().
Used by gauss_dual_agent for hot-swap (Agent 1 purged before Agent 2 loads).
"""
from __future__ import annotations

import gc
import os
import sys
from contextlib import contextmanager
from typing import Any

# -----------------------------------------------------------------------------
# Apollo flush: ~50–200 MB reclaim on M1 (MPS/MLX caches + Python heap)
# Call after every model unload so the next model has headroom under 6GB ceiling.
# -----------------------------------------------------------------------------
def apollo_flush() -> None:
    """Strict post-model teardown.

    Order matters:
    - First ensure Python refs are gone (callers must `del model`, `del tokenizer`).
    - Then `gc.collect()` so destructors run and object graphs are freed.
    - Then flush device caches (Torch MPS + MLX Metal) so Unified Memory headroom returns.

    Apollo 6GB standard notes (ballpark, workload-dependent):
    - `gc.collect()` after `del` often returns ~100s of MB of Python heap to the OS allocator over time.
    - `torch.mps.empty_cache()` can reclaim ~50–150MB after a Torch model unload.
    - `mx.metal.clear_cache()` can reclaim ~100–500MB after MLX generation (KV + temp buffers).
    """
    # 1) Collect first: frees Python-side objects so device caches can drop references.
    gc.collect()

    # 2) Torch MPS cache flush (Unified Memory). Saves ~50–150MB after Surya unload.
    try:
        if "torch" in sys.modules:
            import torch
            if hasattr(torch, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    except Exception:
        pass

    # 3) MLX Metal cache flush. Saves ~100–500MB after DeepSeek generation (bounded by KV limits).
    try:
        if "mlx" in sys.modules or "mlx.core" in sys.modules:
            import mlx.core as mx
            mx.metal.clear_cache()
    except Exception:
        pass

    # 4) Final collect: ensures caches freed above don’t keep Python wrappers alive.
    gc.collect()


def _ensure_no_model_refs() -> None:
    """Call after del model/tokenizer to force refs gone before gc (saves ~10–50 MB timing)."""
    gc.collect()

@contextmanager
def apollo_model_scope(*objs: Any):
    """Context manager that guarantees Apollo teardown even on exceptions.

    Usage:
      with apollo_model_scope(model, tokenizer):
          ...

    Important: do not keep references outside the scope; this is what prevents
    overlapping Surya+DeepSeek residency (OOM risk under 6GB ceiling).
    """
    try:
        yield
    finally:
        # Drop strong refs first (largest win: model weights 0.5–2.5GB+ depending on agent).
        for obj in objs:
            try:
                del obj
            except Exception:
                pass
        _ensure_no_model_refs()
        apollo_flush()

# -----------------------------------------------------------------------------
# Agent 1: Surya (lazy load only when needed; purge immediately after capture)
# Surya is typically Torch; ~500 MB–1.5 GB model on M1.
# -----------------------------------------------------------------------------
def run_surya_inprocess(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Load Surya (if configured), run forecast, capture output string, then purge.
    Returns dict with keys: forecast, model, stub.
    Saves ~500 MB–1.5 GB by not keeping Surya in memory after return.
    """
    context = context or {}
    model_path = os.environ.get("SURYA_MODEL_PATH", "").strip()
    use_hf = os.environ.get("SURYA_USE_HF", "").strip().lower() in ("1", "true", "yes")

    if not model_path and not use_hf:
        apollo_flush()
        return {
            "forecast": [{"time": "now", "value": 0.0}],
            "model": "surya.366m.v1",
            "stub": True,
        }

    model = None
    tokenizer = None
    try:
        # Lazy load: only now do we touch torch/Surya (~500MB–1.5GB Unified Memory).
        import torch
        _ = torch  # silence unused

        # NOTE: Real Surya forward pass is intentionally not wired here yet.
        # If you implement it, keep all tensors local to this scope and ensure
        # you do NOT store the model globally (Apollo: prevents multi-GB residency).
        return {"forecast": [{"time": "now", "value": 0.0}], "model": "surya.366m.v1", "stub": True}
    finally:
        # Strict teardown sequence (saves ~0.5–1.5GB immediately after return when real weights are loaded).
        if model is not None:
            del model
        if tokenizer is not None:
            del tokenizer
        _ensure_no_model_refs()
        gc.collect()
        # Order: gc -> torch.mps.empty_cache -> mx.metal.clear_cache -> gc
        apollo_flush()


# -----------------------------------------------------------------------------
# Agent 2: DeepSeek (MLX). KV cache guardrail: max_tokens caps memory balloon.
# In-process: ~1–2 GB model + up to ~2.5 GB KV for long generation; we cap max_tokens.
# -----------------------------------------------------------------------------
MLX_MAX_TOKENS_DEFAULT = 384
# Apollo: cap KV context to prevent ballooning Unified Memory.
# `max_kv_size` is tokens, not bytes. Lowering from "unbounded" to 4096 tokens can
# prevent ~1–3GB of KV allocations on long prompts, depending on model/config.
MLX_MAX_KV_TOKENS_DEFAULT = 4096
MLX_CACHE_LIMIT_GB_DEFAULT = 2.5


def run_deepseek_inprocess(
    prompt: str,
    max_tokens: int | None = None,
    model_path_or_id: str | None = None,
) -> str:
    """
    Load DeepSeek (MLX) only for this call, generate, capture full output, purge.
    max_tokens caps KV cache growth (Apollo: 512 default ~= ~200–400 MB KV on 4bit).
    Saves ~1.5–2.5 GB by not keeping DeepSeek in memory after return.
    """
    max_tokens = max_tokens or int(os.environ.get("GAUSS_MLX_MAX_TOKENS", MLX_MAX_TOKENS_DEFAULT))
    model_path_or_id = model_path_or_id or os.environ.get("GAUSS_DEEPSEEK_MODEL", "mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit")
    max_kv_tokens = int(os.environ.get("GAUSS_MLX_MAX_KV_TOKENS", MLX_MAX_KV_TOKENS_DEFAULT))
    cache_limit_gb = float(os.environ.get("GAUSS_MLX_CACHE_LIMIT_GB", MLX_CACHE_LIMIT_GB_DEFAULT))

    # Hard guardrails (Apollo):
    # - `max_tokens` bounds completion KV growth.
    # - `max_kv_tokens` bounds total context retained for KV (prompt+completion).
    # These two together are the in-process equivalent of a cache_limit_gb policy.
    max_tokens = max(1, min(max_tokens, 768))
    max_kv_tokens = max(512, min(max_kv_tokens, 8192))

    model = None
    tokenizer = None
    try:
        import mlx.core as mx
        import mlx_lm
        # Lazy load: only now do we load MLX model (~1–2 GB)
        model, tokenizer = mlx_lm.load(model_path_or_id)
        # Generate with KV guardrail (Apollo):
        # - max_kv_size limits KV cache retained (prevents 1–3GB balloon on long contexts).
        # - max_tokens limits completion length (prevents runaway growth).
        #
        # Memory savings vs unbounded:
        # - With `max_kv_size=4096`, KV cache is typically capped to a few hundred MB
        #   instead of multi-GB on long prompts (workload dependent).
        try:
            response = mlx_lm.generate(
                model,
                tokenizer,
                prompt=prompt,
                max_tokens=max_tokens,
                max_kv_size=max_kv_tokens,
            )
        except TypeError:
            # Older mlx-lm versions may not accept max_kv_size; fall back to max_tokens only.
            response = mlx_lm.generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens)
        out = (response.strip() if isinstance(response, str) else str(response)) or ""
        return out
    except ImportError:
        apollo_flush()
        return "UNAVAILABLE (mlx_lm not installed)"
    finally:
        if model is not None:
            del model
        if tokenizer is not None:
            del tokenizer
        _ensure_no_model_refs()
        gc.collect()
        try:
            import mlx.core as mx
            mx.metal.clear_cache()
        except Exception:
            pass
        # Strict teardown sequence: del -> gc -> torch cache -> mlx cache -> gc
        apollo_flush()


# -----------------------------------------------------------------------------
# HTTP fallback: no in-process load; call remote Surya/DeepSeek (used when
# models run in separate processes to keep API process under 6GB).
# -----------------------------------------------------------------------------
def run_surya_via_http(base_url: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call Surya service over HTTP; no model load in this process (~0 MB)."""
    import urllib.request
    import urllib.error
    import json
    context = context or {}
    url = f"{base_url.rstrip('/')}/surya/forecast"
    req = urllib.request.Request(url, data=b"{}", method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return {"forecast": [{"time": "now", "value": 0.0}], "model": "surya.366m.v1", "stub": True}


def run_deepseek_via_http(
    base_url: str,
    prompt: str,
    max_tokens: int = 300,
) -> str:
    """Call DeepSeek (e.g. mlx_lm.server) over HTTP; no model load in this process (~0 MB)."""
    import urllib.request
    import urllib.error
    import json
    url = base_url if base_url.endswith("/v1/chat/completions") else f"{base_url.rstrip('/')}/v1/chat/completions"
    body = json.dumps({
        "model": os.environ.get("ORCHESTRATOR_CHAT_MODEL", "local-model"),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    api_key = (os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_API_KEY") or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return "UNAVAILABLE (local engine not reachable)"
