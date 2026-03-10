#!/usr/bin/env python3
"""
Project Gauss: Stress-test dual-agent hot-swap memory flush (Apollo 6GB).
Runs the triad pipeline multiple times and optionally checks system memory
stays under ceiling. Use to verify no OOM during space-ops simulation.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = REPO_ROOT / "ml"
sys.path.insert(0, str(ML_DIR))


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description="Stress-test dual-agent hot-swap memory")
    p.add_argument("-n", "--runs", type=int, default=5, help="Number of triad runs (default 5)")
    p.add_argument("--ceiling", type=float, default=5800, help="Memory ceiling MB (default 5800)")
    p.add_argument("--source", type=str, default=None, help="Source CSV path (default: create temp stub)")
    p.add_argument("--check-memory", action="store_true", help="Run baseline_ram_check --ceiling after each run")
    p.add_argument("--no-ceiling-check", action="store_true", help="Do not skip run when system is over ceiling (for testing flush only)")
    args = p.parse_args()

    source_path = args.source
    if not source_path:
        stub = REPO_ROOT / "scripts" / "stress_dual_agent_stub.csv"
        stub.parent.mkdir(parents=True, exist_ok=True)
        stub.write_text("timestamp,value\nnow,0.0\n", encoding="utf-8")
        source_path = str(stub)

    from gauss_dual_agent import run_dual_agent_hot_swap

    for i in range(args.runs):
        print(f"Run {i + 1}/{args.runs} ...", flush=True)
        try:
            report = run_dual_agent_hot_swap(
                source_path,
                memory_ceiling_mb=args.ceiling,
                skip_ceiling_check=args.no_ceiling_check,
            )
            if report.get("error"):
                print(f"  Error: {report.get('message', report['error'])}", file=sys.stderr)
                return 1
            summary = (report.get("deepseek") or {}).get("recommendation", "")[:80]
            print(f"  OK — {summary}...", flush=True)
        except Exception as e:
            print(f"  Exception: {e}", file=sys.stderr)
            return 1

        if args.check_memory:
            script = REPO_ROOT / "scripts" / "memory" / "baseline_ram_check.py"
            if script.exists():
                import subprocess
                r = subprocess.run(
                    [sys.executable, str(script), "--ceiling", str(int(args.ceiling))],
                    capture_output=True,
                    timeout=5,
                )
                if r.returncode != 0:
                    print(f"  Memory ceiling exceeded after run {i + 1}", file=sys.stderr)
                    return 1

    print("All runs completed; no OOM.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
