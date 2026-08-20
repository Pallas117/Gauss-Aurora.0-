#!/usr/bin/env python3
"""Observation-only memory and artifact audit for Gauss hardware profiles."""
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
CONFIG = ROOT / "config" / "resource-budgets.json"


def command(args: list[str]) -> str | None:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=3, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def read_config() -> dict[str, Any]:
    try:
        value = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def mac_memory() -> dict[str, Any]:
    total = command(["sysctl", "-n", "hw.memsize"])
    vm_stat = command(["vm_stat"])
    total_mb = None
    try:
        total_mb = round(int(total or "0") / (1024 * 1024), 2)
    except ValueError:
        pass
    return {"totalRamMb": total_mb, "vmStat": vm_stat, "swap": command(["sysctl", "-n", "vm.swapusage"])}


def linux_memory() -> dict[str, Any]:
    values: dict[str, float] = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, _, raw = line.partition(":")
            parts = raw.strip().split()
            if parts:
                values[key] = round(float(parts[0]) / 1024, 2)
    except (OSError, ValueError):
        pass
    return {"totalRamMb": values.get("MemTotal"), "availableRamMb": values.get("MemAvailable"), "meminfo": values}


def process_rss_mb() -> float | None:
    try:
        import psutil  # type: ignore
    except ImportError:
        return None
    total = 0
    names = ("gauss", "node", "vite", "python", "orchestrator", "mlx")
    try:
        processes = psutil.process_iter(["name", "cmdline", "memory_info"])
        for process in processes:
            try:
                name = " ".join([process.info.get("name") or "", *(process.info.get("cmdline") or [])]).lower()
                if any(token in name for token in names):
                    total += int(process.info["memory_info"].rss)
            except (psutil.Error, KeyError, TypeError, PermissionError):
                continue
    except (psutil.Error, PermissionError, OSError):
        return None
    return round(total / (1024 * 1024), 2)


def artifact_size_mb() -> float:
    total = 0
    dist = ROOT / "dist"
    if not dist.is_dir():
        return 0.0
    for file_path in dist.rglob("*"):
        if file_path.is_file():
            try:
                total += file_path.stat().st_size
            except OSError:
                pass
    return round(total / (1024 * 1024), 2)


def build_report(profile: str) -> dict[str, Any]:
    config = read_config()
    budget = (config.get("profiles") or {}).get(profile, {})
    system = platform.system()
    memory = mac_memory() if system == "Darwin" else linux_memory() if system == "Linux" else {}
    report: dict[str, Any] = {
        "schema": "gauss-resource-audit-v1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "profile": profile,
        "host": {"hostname": platform.node(), "system": system, "machine": platform.machine(), "cpuCount": os.cpu_count()},
        "budget": budget,
        "observed": {
            "totalRamMb": memory.get("totalRamMb"),
            "availableRamMb": memory.get("availableRamMb"),
            "processRssMb": process_rss_mb(),
            "distArtifactMb": artifact_size_mb(),
            "workspaceFreeMb": round(shutil.disk_usage(ROOT).free / (1024 * 1024), 2),
            "memoryRaw": memory,
        },
        "checks": [],
        "authority": "observation-only; no host or remote state changed",
    }
    observed = report["observed"]
    checks = [
        ("processRssMb", "processRssBudgetMb"),
        ("distArtifactMb", "distArtifactCeilingMb"),
    ]
    for observed_key, budget_key in checks:
        value = observed.get(observed_key)
        ceiling = budget.get(budget_key)
        state = "unknown" if value is None or ceiling is None else "fail" if value > ceiling else "pass"
        report["checks"].append({"name": observed_key, "observed": value, "ceiling": ceiling, "state": state})
    report["status"] = "fail" if any(check["state"] == "fail" for check in report["checks"]) else "pass"
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="judith-8gb")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--fail-on-over", action="store_true")
    args = parser.parse_args()
    report = build_report(args.profile)
    if args.json_out:
        output = args.json_out if args.json_out.is_absolute() else ROOT / args.json_out
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(report))
    else:
        print(f"[resource-audit] profile={args.profile} status={report['status']} host={report['host']['hostname']}")
        for check in report["checks"]:
            print(f"[resource-audit] {check['name']} state={check['state']} observed={check['observed']} ceiling={check['ceiling']}")
        print(f"[resource-audit] authority={report['authority']}")
    return 1 if args.fail_on_over and report["status"] == "fail" else 0


if __name__ == "__main__":
    sys.exit(main())
