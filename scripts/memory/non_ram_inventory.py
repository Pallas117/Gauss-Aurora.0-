#!/usr/bin/env python3
"""Inventory memory-adjacent capacity without changing host state.

This is intentionally an observation tool. It does not tune swap, mount filesystems,
start remote work, or allocate a spill file. Use it to separate usable evidence from
capacity assumptions before a memory-placement change.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config" / "resource-budgets.json"


def run_text(command: list[str]) -> str | None:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def parse_mb(value: str | None) -> float | None:
    if not value:
        return None
    parts = value.strip().split()
    if not parts:
        return None
    try:
        number = float(parts[0])
    except ValueError:
        return None
    unit = parts[1].lower() if len(parts) > 1 else "b"
    multipliers = {"b": 1 / (1024 * 1024), "kb": 1 / 1024, "mb": 1, "gb": 1024}
    return round(number * multipliers.get(unit, 1), 2)


def collect_memory() -> dict[str, Any]:
    system = platform.system()
    result: dict[str, Any] = {"platform": system, "swap": {}, "compression": {}}

    if system == "Darwin":
        result["swap"]["raw"] = run_text(["sysctl", "-n", "vm.swapusage"])
        result["compression"]["vm_stat"] = run_text(["vm_stat"])
        result["compression"]["compressor_mode"] = run_text(["sysctl", "-n", "vm.compressor_mode"])
        result["total_ram_mb"] = parse_mb(run_text(["sysctl", "-n", "hw.memsize"]))
        return result

    if system == "Linux":
        meminfo: dict[str, float] = {}
        try:
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                key, _, raw = line.partition(":")
                value = parse_mb(raw.strip())
                if value is not None:
                    meminfo[key] = value
        except OSError:
            pass
        result["meminfo_mb"] = meminfo
        result["swap"]["devices"] = run_text(["swapon", "--show", "--bytes"])
        result["compression"]["zram"] = run_text(["zramctl", "--output", "NAME,DISKSIZE,DATA,COMPR,STREAMS", "--bytes"])
        result["total_ram_mb"] = meminfo.get("MemTotal")
        return result

    result["note"] = "Host-specific compression and swap evidence is unavailable for this platform."
    return result


def storage_probe(path: Path) -> dict[str, Any]:
    try:
        usage = shutil.disk_usage(path)
        available_mb = round(usage.free / (1024 * 1024), 2)
        total_mb = round(usage.total / (1024 * 1024), 2)
    except OSError as exc:
        return {"path": str(path), "available_mb": None, "total_mb": None, "writable": False, "error": str(exc)}
    return {
        "path": str(path),
        "available_mb": available_mb,
        "total_mb": total_mb,
        "writable": os.access(path, os.W_OK),
    }


def build_report(profile_name: str, config_path: Path) -> dict[str, Any]:
    config = read_json(config_path)
    profile = config.get("profiles", {}).get(profile_name, {})
    home = Path.home()
    temp = Path(os.getenv("TMPDIR") or "/tmp")
    memory = collect_memory()
    storage = [storage_probe(ROOT), storage_probe(temp)]
    for candidate in (home / ".cache", home / "Library" / "Caches"):
        if candidate.exists():
            storage.append(storage_probe(candidate))

    tiers = [
        {"tier": "ram", "state": "observed", "policy": "hot operational state only; enforce profile RSS and system ceilings"},
        {"tier": "compressed-memory", "state": "observed" if memory.get("compression") else "unknown", "policy": "pressure signal, not planned capacity"},
        {"tier": "swap", "state": "observed" if memory.get("swap") else "unknown", "policy": "do not tune or count as RAM; reduce load when pressure rises"},
        {"tier": "local-ssd-spill", "state": "inferred" if any(item.get("writable") for item in storage) else "blocked", "policy": "bounded replayable cache/artifact spill only; encrypt sensitive data"},
        {"tier": "mmap-page-cache", "state": "inferred", "policy": "read-mostly immutable artifacts with file and mapping caps"},
        {"tier": "unified-gpu-memory", "state": "observed" if platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"} else "unknown", "policy": "counts against the same Apple Silicon RAM budget"},
        {"tier": "remote-compute-memory", "state": "unknown", "policy": "requires authenticated health, resource, residency, and lease evidence", "verification": "npm run audit:compute-sharing"},
    ]

    return {
        "schema": "gauss-memory-tier-inventory-v1",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": {"hostname": platform.node(), "system": platform.system(), "release": platform.release(), "machine": platform.machine(), "cpu_count": os.cpu_count()},
        "profile": profile_name,
        "configured_profile": profile,
        "memory": memory,
        "storage_candidates": storage,
        "tiers": tiers,
        "recommendations": [
            "Keep safety, approvals, secrets, and active request context in bounded RAM.",
            "Use local SSD only for bounded, replayable, permission-restricted spill and immutable artifacts.",
            "Use mmap/page cache for read-mostly model artifacts, never as a guaranteed RAM reservation.",
            "Treat compression and swap growth as a reason to shed load, not as permission to increase concurrency.",
            "Verify remote capacity with the application-level compute-sharing audit before dispatching work.",
        ],
        "authority": "observation-only; no host or remote state changed",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory non-RAM memory tiers for Gauss")
    parser.add_argument("--profile", default="judith-8gb")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a summary")
    parser.add_argument("--json-out", type=Path, help="Write the report to a JSON file")
    args = parser.parse_args()

    report = build_report(args.profile, args.config)
    if args.json_out:
        output = args.json_out if args.json_out.is_absolute() else ROOT / args.json_out
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(report))
    else:
        print(f"[non-ram-inventory] profile={args.profile} host={report['host']['hostname']}")
        print(f"[non-ram-inventory] platform={report['host']['system']} machine={report['host']['machine']}")
        for tier in report["tiers"]:
            print(f"[non-ram-inventory] {tier['tier']} state={tier['state']} policy={tier['policy']}")
        print("[non-ram-inventory] authority=observation-only; no host or remote state changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
