#!/usr/bin/env python3
"""
Project Gauss: 6GB Apollo memory audit.
- Baseline: confirm idle Rust orchestrator + React HUD sit below 500MB (process RSS sum).
- Ceiling: report system memory used; exit 1 if over threshold (e.g. 5.8GB) for PM packet-dropping.
Requires: pip install psutil
"""
from __future__ import annotations

import argparse
import json
import sys

try:
    import psutil
except ImportError:
    print("psutil not found. Install with: pip install psutil", file=sys.stderr)
    sys.exit(2)


def collect_process_rss_mb() -> float:
    keywords = ("gauss", "orchestrator", "node", "vite", "cargo")
    rss_sum_mb = 0.0
    for proc in psutil.process_iter(["pid", "name", "cmdline", "memory_info"]):
        try:
            name = (proc.info.get("name") or "").lower()
            cmdline = proc.info.get("cmdline") or []
            cmd = " ".join(cmdline).lower() if isinstance(cmdline, list) else str(cmdline).lower()
            if any(kw in name or kw in cmd for kw in keywords):
                mi = proc.info.get("memory_info")
                if mi and hasattr(mi, "rss"):
                    rss_sum_mb += mi.rss / (1024 * 1024)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return rss_sum_mb


def main() -> int:
    parser = argparse.ArgumentParser(description="Gauss memory baseline and ceiling check")
    parser.add_argument(
        "--baseline",
        type=float,
        default=None,
        metavar="MB",
        help="Pass if sum RSS of gauss/node/vite/orchestrator processes < MB (default: 500)",
    )
    parser.add_argument(
        "--ceiling",
        type=float,
        default=None,
        metavar="MB",
        help="Exit 1 if system memory used > MB (e.g. 5800 for 5.8GB panic ceiling)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON with rss_mb, system_used_mb, system_available_mb",
    )
    args = parser.parse_args()

    # System memory (used/available in bytes)
    vmem = psutil.virtual_memory()
    system_used_mb = vmem.used / (1024 * 1024)
    system_available_mb = vmem.available / (1024 * 1024)

    # Ceiling check only needs system memory, so avoid full process enumeration.
    if args.ceiling is not None and args.baseline is None and not args.json:
        if system_used_mb > args.ceiling:
            print(f"Memory ceiling exceeded: {system_used_mb:.0f} MB > {args.ceiling:.0f} MB", file=sys.stderr)
            return 1
        return 0

    rss_sum_mb: float | None = None
    rss_error: str | None = None
    try:
        rss_sum_mb = collect_process_rss_mb()
    except PermissionError as exc:
        rss_error = str(exc)
    except psutil.Error as exc:
        rss_error = str(exc)

    if args.json:
        out = {
            "rss_mb": None if rss_sum_mb is None else round(rss_sum_mb, 2),
            "system_used_mb": round(system_used_mb, 2),
            "system_available_mb": round(system_available_mb, 2),
        }
        if rss_error:
            out["rss_error"] = rss_error
        print(json.dumps(out))
        return 0

    # Baseline check: pass if process sum below threshold
    if args.baseline is not None:
        if rss_sum_mb is None:
            print(f"Baseline memory check unavailable: {rss_error or 'process enumeration failed'}", file=sys.stderr)
            return 3
        if rss_sum_mb >= args.baseline:
            print(f"Baseline exceeded: process RSS sum {rss_sum_mb:.0f} MB >= {args.baseline:.0f} MB", file=sys.stderr)
            return 1
        return 0

    # Default: print human summary, exit 0
    if rss_sum_mb is None:
        print(f"Process RSS sum (gauss/node/vite): unavailable ({rss_error or 'process enumeration failed'})")
    else:
        print(f"Process RSS sum (gauss/node/vite): {rss_sum_mb:.0f} MB")
    print(f"System used: {system_used_mb:.0f} MB  available: {system_available_mb:.0f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
