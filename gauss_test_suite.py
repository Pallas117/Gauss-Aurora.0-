#!/usr/bin/env python3
"""
Project Gauss: OOM stress test for Alpha Go/No-Go.
- Verifies baseline_ram_check.py --ceiling exits 0 when under and 1 when over.
- Uses a low ceiling (200MB) and small allocation (250MB) so the test is safe on CI and 8GB machines.
- In production, ceiling is 5800 (5.8GB); PM sub-agent drops ingest when script exits 1.
Run with: python3 gauss_test_suite.py
Requires: psutil (pip install psutil)
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

try:
    import psutil
except ImportError:
    print("psutil required: pip install psutil", file=sys.stderr)
    sys.exit(2)

# Safe allocation for CI (no 5.5GB)
ALLOC_MB = 300


def run_ceiling(script: Path, ceiling_mb: float) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(script), "--ceiling", str(int(ceiling_mb))],
        capture_output=True,
        text=True,
        timeout=5,
        cwd=str(Path(__file__).parent),
    )


def get_system_used_mb(script: Path) -> float:
    r = subprocess.run(
        [sys.executable, str(script), "--json"],
        capture_output=True,
        text=True,
        timeout=5,
        cwd=str(Path(__file__).parent),
    )
    assert r.returncode == 0, r.stderr
    data = json.loads(r.stdout)
    return float(data["system_used_mb"])


def allocate_mb(mb: int) -> list[bytes]:
    """Allocate ~mb MB and return list of chunks (kept so memory is not freed)."""
    chunks: list[bytes] = []
    one_mb = 1024 * 1024
    chunk = 50
    allocated = 0
    try:
        while allocated < mb:
            chunks.append(b"x" * (chunk * one_mb))
            allocated += chunk
    except MemoryError:
        pass
    return chunks


def main() -> int:
    print("Gauss OOM stress test (PM panic ceiling)")
    root = Path(__file__).parent
    script = root / "scripts" / "memory" / "baseline_ram_check.py"
    if not script.exists():
        print(f"Missing {script}", file=sys.stderr)
        return 2

    print("1. Ceiling script: under limit (exit 0)...")
    used_before = get_system_used_mb(script)
    ceiling_above_now = used_before + 50
    r = run_ceiling(script, ceiling_above_now)
    assert r.returncode == 0, f"Should pass when under ceiling: {r.stderr}"
    print("   OK")

    print(f"2. Allocating ~{ALLOC_MB} MB...")
    chunks = allocate_mb(ALLOC_MB)
    proc = psutil.Process()
    rss_mb = proc.memory_info().rss / (1024 * 1024)
    print(f"   Process RSS ~{rss_mb:.0f} MB (chunks: {len(chunks)})")

    print("3. Ceiling script: over limit (exit 1) so PM drops packets...")
    used_after = get_system_used_mb(script)
    r = run_ceiling(script, ceiling_above_now)
    assert r.returncode == 1, (
        f"Must exit 1 when over ceiling so PM drops packets (used_after={used_after:.0f} MB, ceiling={ceiling_above_now:.0f}). stderr: {r.stderr}"
    )
    print("   OK")

    print("PASS: PM sub-agent would drop packets when RAM hits ceiling (5.8GB in production).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
