#!/usr/bin/env python3
"""
Project Gauss: Dual-Agent Hot-Swapping (Apollo 6GB Standard).
One model in Unified Memory at a time. Agent 1 (Surya) -> full purge -> Agent 2 (DeepSeek).
Strict sequence between agents: del model/tokenizer -> gc.collect() -> torch.mps.empty_cache()
-> mx.metal.clear_cache(). Never load Agent 2 until Agent 1 is fully unloaded.

Usage:
  python ml/gauss_dual_agent.py <source_path>              # single run, JSON to stdout
  python ml/gauss_dual_agent.py <source_path> --stress 20  # 20 hot-swap iterations, log RSS, fail if over ceiling
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure ml/ is on path when run as script (e.g. python ml/gauss_dual_agent.py)
_ml_dir = Path(__file__).resolve().parent
if _ml_dir not in sys.path:
    sys.path.insert(0, str(_ml_dir))

from gauss_engine import (
    apollo_flush,
    run_deepseek_inprocess,
    run_deepseek_via_http,
    run_surya_inprocess,
    run_surya_via_http,
)

def _get_rss_mb() -> float | None:
    """Current process RSS in MB. Returns None if unavailable."""
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        pass
    try:
        import resource
        # ru_maxrss: macOS = bytes, Linux = KB
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            return rss / (1024 * 1024)
        return rss / 1024
    except Exception:
        return None


# Apollo: optional pre-flight ceiling check (script may not be in path)
def _memory_under_ceiling_mb(ceiling_mb: float = 5800.0) -> bool:
    """True if system used memory is at or below ceiling. Saves OOM during load."""
    try:
        import subprocess
        script = Path(__file__).resolve().parent.parent / "scripts" / "memory" / "baseline_ram_check.py"
        if not script.exists():
            return True
        r = subprocess.run(
            [sys.executable, str(script), "--ceiling", str(int(ceiling_mb))],
            capture_output=True,
            timeout=5,
        )
        return r.returncode == 0
    except Exception:
        return True


def run_agent1_surya(csv_path: str, use_http: bool) -> dict[str, Any]:
    """
    Agent 1: Surya. Load only when this runs; purge immediately after capture.
    use_http=True: no in-process load (~0 MB). use_http=False: in-process load then purge (~500 MB–1.5 GB freed before Agent 2).
    """
    surya_url = (os.environ.get("SURYA_SERVICE_URL") or "").strip()
    if use_http and surya_url:
        out = run_surya_via_http(surya_url, {})
        path = Path(csv_path)
        return {
            "worker": "surya",
            "model": out.get("model", "surya.366m.v1"),
            "forecast": out.get("forecast", [{"time": "now", "value": 0.0}]),
            "source_path": csv_path,
            "source_size_bytes": path.stat().st_size if path.exists() else 0,
            "stub": False,
        }
    # In-process: load -> run -> purge (apollo_flush inside run_surya_inprocess)
    out = run_surya_inprocess({"source_path": csv_path})
    path = Path(csv_path)
    return {
        "worker": "surya",
        "model": out.get("model", "surya.366m.v1"),
        "forecast": out.get("forecast", [{"time": "now", "value": 0.0}]),
        "source_path": csv_path,
        "source_size_bytes": path.stat().st_size if path.exists() else 0,
        "stub": out.get("stub", True),
    }


def run_agent2_deepseek(csv_path: str, surya_output: dict[str, Any], use_http: bool) -> dict[str, Any]:
    """
    Agent 2: DeepSeek. Load only after Agent 1 is fully purged (caller must call apollo_flush between).
    use_http=True: no in-process load (~0 MB). use_http=False: in-process MLX load then purge (~1.5–2.5 GB freed after).
    """
    prompt = f"""You are the Gauss space-ops co-pilot. Use only NOMINAL, MONITOR, or INITIATE SHIELDING with a brief rationale.
Context: {json.dumps(surya_output)[:500]}
CSV path: {csv_path}
Provide a brief mission assessment (2-4 sentences). Output: one of NOMINAL / MONITOR / INITIATE SHIELDING and one-line rationale."""

    brain_url = (os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_URL") or os.environ.get("GAUSS_BRAIN_URL") or "").strip()
    if not brain_url:
        brain_url = "http://127.0.0.1:8089/v1/chat/completions"

    if use_http:
        content = run_deepseek_via_http(brain_url, prompt, max_tokens=300)
    else:
        # In-process: load MLX -> generate (max_tokens cap) -> purge
        content = run_deepseek_inprocess(prompt, max_tokens=300)

    return {
        "worker": "deepseek",
        "recommendation": (content or "")[:200],
        "reasoning": content or "",
        "stub": not content or "UNAVAILABLE" in content,
    }


def run_dual_agent_hot_swap(
    csv_path: str,
    *,
    use_http_surya: bool | None = None,
    use_http_deepseek: bool | None = None,
    memory_ceiling_mb: float = 5800.0,
    skip_ceiling_check: bool = False,
) -> dict[str, Any]:
    """
    Bulletproof hot-swap: Agent 1 -> full purge -> Agent 2 -> full purge.
    - use_http_*: True = call remote service (no model in this process). None = auto from env.
    - memory_ceiling_mb: skip load if system already over (Apollo 6GB). Set skip_ceiling_check=True to run anyway.
    """
    # Default: use HTTP when URLs are set, or for DeepSeek use default 127.0.0.1:8089 so we don't load MLX in-process (avoids Metal in CI/sandbox)
    surya_url = (os.environ.get("SURYA_SERVICE_URL") or "").strip()
    brain_url = (os.environ.get("ORCHESTRATOR_LOCAL_ENGINE_URL") or os.environ.get("GAUSS_BRAIN_URL") or "").strip()
    use_http_surya = use_http_surya if use_http_surya is not None else bool(surya_url)
    # In-process DeepSeek only when explicitly requested (GAUSS_DEEPSEEK_INPROCESS=1); else HTTP (default URL or user URL)
    want_inprocess_deepseek = os.environ.get("GAUSS_DEEPSEEK_INPROCESS", "").strip().lower() in ("1", "true", "yes")
    use_http_deepseek = use_http_deepseek if use_http_deepseek is not None else (not want_inprocess_deepseek)

    if not skip_ceiling_check and not _memory_under_ceiling_mb(memory_ceiling_mb):
        return {
            "error": "memory_ceiling_exceeded",
            "message": f"System memory over {memory_ceiling_mb:.0f} MB ceiling; skipping dual-agent run.",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    # --- Agent 1: Surya (load if in-process, then purge) ---
    surya_out = run_agent1_surya(csv_path, use_http=use_http_surya)
    # Mandatory flush between agents (Apollo 6GB):
    # - after Surya: reclaims ~50–150MB Torch MPS cache + Python heap churn
    # - ensures we never overlap Surya + DeepSeek residency (prevents OOM)
    apollo_flush()

    # --- Agent 2: DeepSeek (load if in-process, then purge) ---
    deepseek_out = run_agent2_deepseek(csv_path, surya_out, use_http=use_http_deepseek)
    # Mandatory flush after DeepSeek: reclaims ~100–500MB MLX Metal cache + Python heap churn
    apollo_flush()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "surya": surya_out,
        "deepseek": deepseek_out,
        "summary": deepseek_out.get("recommendation", ""),
    }


def stress_run(
    csv_path: str,
    iterations: int,
    ceiling_mb: float = 5800.0,
    skip_ceiling_check: bool = False,
) -> None:
    """
    Run N hot-swap iterations, log RSS before/after each, exit 1 if RSS ever exceeds ceiling (Apollo 6GB).
    """
    for i in range(1, iterations + 1):
        rss_before = _get_rss_mb()
        report = run_dual_agent_hot_swap(
            csv_path,
            memory_ceiling_mb=ceiling_mb,
            skip_ceiling_check=skip_ceiling_check,
        )
        rss_after = _get_rss_mb()

        if report.get("error") == "memory_ceiling_exceeded":
            print(f"[stress] iteration {i}: SKIP (pre-flight ceiling exceeded)", file=sys.stderr)
            sys.exit(1)

        rss_b = f"{rss_before:.1f}" if rss_before is not None else "?"
        rss_a = f"{rss_after:.1f}" if rss_after is not None else "?"
        print(f"[stress] iteration {i}/{iterations}  RSS before={rss_b} MB  after={rss_a} MB  summary={report.get('summary', '')[:60]!r}", file=sys.stderr)

        if rss_after is not None and rss_after > ceiling_mb:
            print(
                f"[stress] FAIL: RSS {rss_after:.1f} MB exceeds ceiling {ceiling_mb:.0f} MB (Apollo 6GB)",
                file=sys.stderr,
            )
            sys.exit(1)

    print(f"[stress] OK: {iterations} iterations completed under {ceiling_mb:.0f} MB ceiling", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dual-agent hot-swap (Surya -> purge -> DeepSeek). Apollo 6GB memory ceiling.",
    )
    parser.add_argument("source_path", help="Path to CSV (or other source) for Surya context")
    parser.add_argument(
        "--stress",
        type=int,
        metavar="N",
        default=0,
        help="Run N hot-swap iterations; log RSS each time and exit 1 if RSS exceeds --ceiling",
    )
    parser.add_argument(
        "--ceiling",
        type=float,
        default=5800.0,
        metavar="MB",
        help="Memory ceiling in MB (default 5800 for Apollo 6GB). Stress mode fails if RSS exceeds this.",
    )
    parser.add_argument(
        "--skip-ceiling-check",
        action="store_true",
        help="Skip pre-flight ceiling check (run anyway; stress still fails if RSS exceeds --ceiling)",
    )
    args = parser.parse_args()

    if args.stress > 0:
        stress_run(
            args.source_path,
            iterations=args.stress,
            ceiling_mb=args.ceiling,
            skip_ceiling_check=args.skip_ceiling_check,
        )
        return

    report = run_dual_agent_hot_swap(
        args.source_path,
        memory_ceiling_mb=args.ceiling,
        skip_ceiling_check=args.skip_ceiling_check,
    )
    print(json.dumps(report))


if __name__ == "__main__":
    main()
