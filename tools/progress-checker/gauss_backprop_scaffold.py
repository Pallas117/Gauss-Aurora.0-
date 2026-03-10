#!/usr/bin/env python3
"""Gauss backpropagation scaffold.

Build a compact "context capsule" from current repo state so future prompts
need less context window. The scaffold backpropagates from milestone deficits
to the highest-leverage next actions.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class GitSnapshot:
    branch: str
    dirty: bool
    modified: int
    staged: int
    untracked: int
    conflicts: int
    hotspots: list[tuple[str, int]]
    changed_files: list[str]


@dataclass
class BackpropAction:
    milestone: str
    key: str
    label: str
    target: str
    hint: str
    score: float


def run_cmd(cmd: list[str], cwd: Path) -> tuple[int, str, str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def resolve_root(start: Path, explicit_root: str | None) -> Path:
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()

    code, out, _ = run_cmd(["git", "rev-parse", "--show-toplevel"], start)
    if code == 0 and out:
        return Path(out).resolve()
    return start.resolve()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_porcelain_line(line: str) -> tuple[str, str]:
    if len(line) < 4:
        return "", ""
    raw_path = line[3:]
    if " -> " in raw_path:
        _, rhs = raw_path.split(" -> ", 1)
        return line[:2], normalize_path(rhs.strip())
    return line[:2], normalize_path(raw_path.strip())


def normalize_path(path: str) -> str:
    value = path.strip()
    if value.startswith('"') and value.endswith('"') and len(value) >= 2:
        value = value[1:-1]
    value = value.replace('\\"', '"')
    return value


def collect_git_snapshot(root: Path, max_files: int) -> GitSnapshot:
    code, branch, _ = run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)
    if code != 0 or not branch:
        branch = "unknown"

    code, status_out, _ = run_cmd(["git", "status", "--porcelain"], root)
    lines = status_out.splitlines() if code == 0 and status_out else []

    modified = 0
    staged = 0
    untracked = 0
    conflicts = 0
    buckets: dict[str, int] = {}
    changed_files: list[str] = []

    for line in lines:
        if line.startswith("?? "):
            untracked += 1
        elif len(line) >= 2:
            x, y = line[0], line[1]
            if x != " ":
                staged += 1
            if y != " ":
                modified += 1
            if x == "U" or y == "U":
                conflicts += 1

        _, path = parse_porcelain_line(line)
        if not path:
            continue
        changed_files.append(path)
        top = path.split("/", 1)[0]
        buckets[top] = buckets.get(top, 0) + 1

    hotspots = sorted(buckets.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    changed_files = changed_files[:max_files]
    dirty = bool(lines)

    return GitSnapshot(
        branch=branch,
        dirty=dirty,
        modified=modified,
        staged=staged,
        untracked=untracked,
        conflicts=conflicts,
        hotspots=hotspots,
        changed_files=changed_files,
    )


def load_progress_payload(root: Path) -> dict[str, Any]:
    script_path = root / "tools" / "progress-checker" / "gauss_progress_bar.py"
    if not script_path.is_file():
        return {
            "generated_at": now_iso(),
            "overall": 0,
            "milestones": [],
            "velocity": None,
            "error": f"missing progress checker: {script_path}",
        }

    code, out, err = run_cmd(["python3", str(script_path), "--json"], root)
    if code != 0:
        return {
            "generated_at": now_iso(),
            "overall": 0,
            "milestones": [],
            "velocity": None,
            "error": f"progress checker failed: {err or out}",
        }

    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        return {
            "generated_at": now_iso(),
            "overall": 0,
            "milestones": [],
            "velocity": None,
            "error": f"invalid progress JSON: {exc}",
        }


def collect_routes(root: Path) -> list[str]:
    routes_path = root / "src" / "app" / "routes.tsx"
    if not routes_path.is_file():
        return []
    text = routes_path.read_text(encoding="utf-8", errors="ignore")
    routes: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if 'path: "' in line:
            try:
                route = line.split('path: "', 1)[1].split('"', 1)[0]
                if route and not route.startswith("/") and route != "*":
                    route = f"/{route}"
                routes.append(route)
            except Exception:
                continue
    if "index: true" in text and "/" not in routes:
        routes.insert(0, "/")
    seen: set[str] = set()
    uniq: list[str] = []
    for route in routes:
        if route not in seen:
            seen.add(route)
            uniq.append(route)
    return uniq[:16]


def collect_endpoints(root: Path) -> list[str]:
    server_path = root / "backend" / "server.ts"
    if not server_path.is_file():
        return []
    text = server_path.read_text(encoding="utf-8", errors="ignore")
    values: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("app."):
            continue
        if "(" not in line or '"' not in line:
            continue
        try:
            path = line.split('"', 1)[1].split('"', 1)[0]
        except Exception:
            continue
        if path.startswith("/api/ops/") or path.startswith("/api/auth/") or path.startswith("/api/feed/") or path.startswith("/api/security/") or path.startswith("/api/ai/"):
            values.append(path)
    seen: set[str] = set()
    endpoints: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            endpoints.append(value)
    return endpoints[:24]


def load_backend_ai_granular_summary(root: Path) -> str | None:
    """Read backend-ai-granular.latest.json if present; return one-line summary for the capsule."""
    path = root / "reports" / "progress" / "backend-ai-granular.latest.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        summary = data.get("summary") or {}
        passed = int(summary.get("passed", 0))
        failed = int(summary.get("failed", 0))
        total = int(summary.get("total", 0))
        if total == 0:
            return None
        return f"Backend/AI granular: {passed} passed, {failed} failed ({total} total)"
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


def load_last_autonomous_eval(root: Path) -> str | None:
    """Read last line of autonomous-evaluation.jsonl and return a one-line summary for the capsule."""
    path = root / "reports" / "context" / "autonomous-evaluation.jsonl"
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            return None
        last = json.loads(lines[-1])
        k = last.get("issues_fixed", 0) or last.get("issues_attempted", 0)
        before = last.get("progress_pct_before")
        after = last.get("progress_pct_after")
        if before is not None and after is not None:
            return f"Last autonomous run: {k} patches, progress {before:.0f}% -> {after:.0f}%"
        return f"Last autonomous run: {k} patches applied."
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = int(max(0, min(len(ordered) - 1, round((len(ordered) - 1) * p))))
    return ordered[idx]


def parse_monitoring_summary(summary_path: Path) -> dict[str, Any]:
    info: dict[str, Any] = {"summary_path": str(summary_path)}
    metrics: dict[str, dict[str, Any]] = {}
    in_metrics = False

    for raw in summary_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == "metric,avg,min,max,samples":
            in_metrics = True
            continue
        if in_metrics:
            parts = [item.strip() for item in line.split(",")]
            if len(parts) == 5:
                metric_name = parts[0]
                metrics[metric_name] = {
                    "avg": parse_float(parts[1]),
                    "min": parse_float(parts[2]),
                    "max": parse_float(parts[3]),
                    "samples": parse_int(parts[4]),
                }
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            info[key.strip()] = value.strip()

    info["metrics"] = metrics
    for numeric_key in (
        "interval_sec",
        "requested_duration_hours",
        "samples_captured",
        "elapsed_hours",
        "battery_start_percent",
        "battery_end_percent",
        "battery_drain_percent_per_hour",
    ):
        if numeric_key in info:
            parsed = parse_float(info[numeric_key])
            if parsed is not None:
                info[numeric_key] = int(parsed) if float(parsed).is_integer() else parsed
    return info


def load_latest_overnight_monitoring(root: Path) -> dict[str, Any] | None:
    monitoring_dir = root / "reports" / "monitoring"
    if not monitoring_dir.is_dir():
        return None

    summaries = sorted(
        monitoring_dir.glob("overnight-*.summary.txt"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not summaries:
        return None

    summary_path = summaries[0]
    summary = parse_monitoring_summary(summary_path)
    label = str(summary.get("label") or summary_path.name.replace(".summary.txt", "")).strip()
    jsonl_path = monitoring_dir / f"{label}.jsonl"
    if not jsonl_path.is_file():
        from_summary = summary.get("jsonl")
        if isinstance(from_summary, str):
            candidate = (root / from_summary).resolve()
            if candidate.is_file():
                jsonl_path = candidate
    if not jsonl_path.is_file():
        return {
            "label": label,
            "summary_path": str(summary_path),
            "alerts": ["No JSONL data found for latest overnight summary."],
            "actions": [],
        }

    rows: list[dict[str, Any]] = []
    for raw in jsonl_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
        except json.JSONDecodeError:
            continue

    if not rows:
        return {
            "label": label,
            "summary_path": str(summary_path),
            "jsonl_path": str(jsonl_path),
            "alerts": ["Latest overnight JSONL had no readable samples."],
            "actions": [],
        }

    mem_unused = [float(v) for v in (parse_float(row.get("mem_unused_mb")) for row in rows) if v is not None]
    gauss_cpu = [float(v) for v in (parse_float(row.get("gauss_cpu_pct")) for row in rows) if v is not None]
    gpu_device = [float(v) for v in (parse_float(row.get("gpu_device_util_pct")) for row in rows) if v is not None]
    load_1m = [float(v) for v in (parse_float(row.get("load_avg_1m")) for row in rows) if v is not None]

    mem_p50 = percentile(mem_unused, 0.50)
    mem_p95 = percentile(mem_unused, 0.95)
    gauss_p95 = percentile(gauss_cpu, 0.95)
    gpu_p95 = percentile(gpu_device, 0.95)
    load_p95 = percentile(load_1m, 0.95)

    low_headroom_count = sum(1 for v in mem_unused if v <= 100.0)
    gauss_spike_count = sum(1 for v in gauss_cpu if v >= 60.0)
    gpu_spike_count = sum(1 for v in gpu_device if v >= 45.0)

    alerts: list[str] = []
    actions: list[dict[str, Any]] = []

    if mem_p50 is not None and mem_p50 < 180.0:
        alerts.append(f"Low memory headroom overnight (mem_unused p50 {mem_p50:.0f}MB, <=100MB for {low_headroom_count} samples).")
        actions.append(
            {
                "milestone": "Runtime Efficiency",
                "key": "monitoring-memory-headroom",
                "label": "Low free memory headroom overnight",
                "target": str(root / "playwright.config.ts"),
                "hint": "Constrain default Playwright worker count when free RAM is low to reduce swap and UI flake.",
                "score": 28.0,
            }
        )

    if gauss_p95 is not None and gauss_p95 >= 50.0:
        alerts.append(f"Gauss CPU bursts observed (p95 {gauss_p95:.1f}%, spikes>=60%: {gauss_spike_count}).")
        actions.append(
            {
                "milestone": "Runtime Efficiency",
                "key": "monitoring-cpu-bursts",
                "label": "Burst CPU spikes in monitored processes",
                "target": str(root / "src/pages/AutomationPage.tsx"),
                "hint": "Replace fixed polling loops with adaptive cadence tied to power/profile constraints.",
                "score": 26.0,
            }
        )

    if gpu_p95 is not None and gpu_p95 >= 35.0:
        alerts.append(f"GPU burst windows detected (device util p95 {gpu_p95:.1f}%, spikes>=45%: {gpu_spike_count}).")
        actions.append(
            {
                "milestone": "Runtime Efficiency",
                "key": "monitoring-gpu-bursts",
                "label": "Burst GPU load windows",
                "target": str(root / "src/pages/SDAPage.tsx"),
                "hint": "Use lightweight SVG SDA fallback in low-power or compact viewport sessions.",
                "score": 24.0,
            }
        )

    if load_p95 is not None and load_p95 >= 5.5:
        alerts.append(f"Host load jitter high (1m load p95 {load_p95:.2f}); avoid full-parallel heavy suites by default.")

    return {
        "label": label,
        "summary_path": str(summary_path),
        "jsonl_path": str(jsonl_path),
        "samples": len(rows),
        "sample_window_start": rows[0].get("ts_local"),
        "sample_window_end": rows[-1].get("ts_local"),
        "battery_start_percent": rows[0].get("battery_percent"),
        "battery_end_percent": rows[-1].get("battery_percent"),
        "battery_state_start": rows[0].get("battery_state"),
        "battery_state_end": rows[-1].get("battery_state"),
        "metrics": {
            "mem_unused_p50_mb": mem_p50,
            "mem_unused_p95_mb": mem_p95,
            "gauss_cpu_p95_pct": gauss_p95,
            "gpu_device_p95_pct": gpu_p95,
            "load_avg_1m_p95": load_p95,
            "low_mem_headroom_samples": low_headroom_count,
            "gauss_cpu_spike_samples": gauss_spike_count,
            "gpu_spike_samples": gpu_spike_count,
        },
        "summary_metrics": summary.get("metrics", {}),
        "alerts": alerts,
        "actions": actions,
    }


def backprop_actions(progress: dict[str, Any], max_items: int) -> list[BackpropAction]:
    milestones = progress.get("milestones") or []
    actions: list[BackpropAction] = []
    for idx, milestone in enumerate(milestones):
        name = str(milestone.get("name", "unknown"))
        score = int(milestone.get("score", 0))
        missing = milestone.get("missing") or []
        if score >= 100 or not missing:
            continue
        deficit = max(1, 100 - score)
        denom = max(1, len(missing))
        for miss in missing:
            key = str(miss.get("key", "missing-key"))
            label = str(miss.get("label", "missing requirement"))
            target = str(miss.get("target", "unknown"))
            hint = str(miss.get("hint", "Implement this requirement"))
            # Higher milestone index + larger deficit = higher urgency.
            weight = float(deficit / denom) + float(idx * 2)
            actions.append(
                BackpropAction(
                    milestone=name,
                    key=key,
                    label=label,
                    target=target,
                    hint=hint,
                    score=round(weight, 2),
                )
            )
    actions.sort(key=lambda item: (-item.score, item.milestone, item.key))
    return actions[:max_items]


def build_capsule(root: Path, git: GitSnapshot, progress: dict[str, Any], max_actions: int) -> dict[str, Any]:
    overall = int(progress.get("overall", 0))
    velocity = progress.get("velocity")
    milestones = progress.get("milestones") or []
    incomplete = next((m for m in milestones if int(m.get("score", 0)) < 100), None)
    routes = collect_routes(root)
    endpoints = collect_endpoints(root)
    actions = backprop_actions(progress, max_items=max(1, max_actions * 2))
    overnight_monitoring = load_latest_overnight_monitoring(root)
    for item in overnight_monitoring.get("actions", []) if isinstance(overnight_monitoring, dict) else []:
        try:
            actions.append(
                BackpropAction(
                    milestone=str(item.get("milestone", "Runtime Efficiency")),
                    key=str(item.get("key", "monitoring-action")),
                    label=str(item.get("label", "Monitoring-driven action")),
                    target=str(item.get("target", str(root))),
                    hint=str(item.get("hint", "Apply targeted runtime optimization.")),
                    score=float(item.get("score", 0)),
                )
            )
        except (TypeError, ValueError):
            continue
    actions.sort(key=lambda item: (-item.score, item.milestone, item.key))
    actions = actions[:max(1, max_actions)]

    blockers = [f"{item.milestone}: {item.label}" for item in actions[:5]]
    if isinstance(overnight_monitoring, dict):
        for alert in overnight_monitoring.get("alerts", [])[:2]:
            blockers.append(f"Overnight monitoring: {alert}")
    if git.conflicts > 0:
        blockers.insert(0, f"Merge conflicts present: {git.conflicts}")
    if git.dirty and overall >= 90:
        blockers.append("High readiness but large dirty worktree; isolate scope before release.")

    last_autonomous = load_last_autonomous_eval(root)
    backend_ai_granular = load_backend_ai_granular_summary(root)

    return {
        "generated_at": now_iso(),
        "root": str(root),
        "branch": git.branch,
        "last_autonomous_run": last_autonomous,
        "backend_ai_granular": backend_ai_granular,
        "overnight_monitoring": overnight_monitoring,
        "readiness": {
            "overall": overall,
            "velocity_points_per_day": None if not isinstance(velocity, dict) else velocity.get("points_per_day"),
            "next_incomplete_milestone": None if not incomplete else incomplete.get("name"),
        },
        "worktree": {
            "dirty": git.dirty,
            "modified": git.modified,
            "staged": git.staged,
            "untracked": git.untracked,
            "conflicts": git.conflicts,
            "hotspots": [{"area": area, "count": count} for area, count in git.hotspots],
            "sample_changed_files": git.changed_files,
        },
        "routes": routes,
        "critical_endpoints": endpoints,
        "backprop_actions": [
            {
                "milestone": item.milestone,
                "key": item.key,
                "label": item.label,
                "target": item.target,
                "hint": item.hint,
                "score": item.score,
            }
            for item in actions
        ],
        "blockers": blockers,
        "prompt_capsule": {
            "goal": "Use this capsule as the only context primer, then request only missing file reads.",
            "now": blockers[:3],
            "next": [item.hint for item in actions[:3]],
            "scope_rule": "Work only in hotspot areas unless blocker requires cross-cutting change.",
            "last_autonomous_run": last_autonomous,
        },
    }


def render_markdown(capsule: dict[str, Any]) -> str:
    readiness = capsule["readiness"]
    worktree = capsule["worktree"]
    lines: list[str] = []
    lines.append("# Gauss Backprop Context Capsule")
    lines.append("")
    lines.append(f"- Generated: `{capsule['generated_at']}`")
    lines.append(f"- Root: `{capsule['root']}`")
    lines.append(f"- Branch: `{capsule['branch']}`")
    lines.append(
        f"- Readiness: `{readiness['overall']}%` (velocity/day: `{readiness['velocity_points_per_day']}`)"
    )
    lines.append(f"- Next incomplete milestone: `{readiness['next_incomplete_milestone']}`")
    if capsule.get("last_autonomous_run"):
        lines.append(f"- {capsule['last_autonomous_run']}")
    if capsule.get("backend_ai_granular"):
        lines.append(f"- {capsule['backend_ai_granular']}")
    monitoring = capsule.get("overnight_monitoring")
    if isinstance(monitoring, dict) and monitoring.get("label"):
        lines.append(f"- Overnight monitoring: `{monitoring.get('label')}`")
    lines.append("")
    lines.append("## Worktree")
    lines.append(
        f"- Dirty: `{worktree['dirty']}` | modified `{worktree['modified']}`, staged `{worktree['staged']}`, untracked `{worktree['untracked']}`, conflicts `{worktree['conflicts']}`"
    )
    lines.append("- Hotspots:")
    for item in worktree["hotspots"]:
        lines.append(f"  - `{item['area']}` ({item['count']})")
    lines.append("")
    lines.append("## Backprop Actions (highest leverage)")
    actions = capsule["backprop_actions"]
    if not actions:
        lines.append("- No explicit milestone deficits found.")
    else:
        for action in actions:
            lines.append(
                f"- [{action['milestone']}] `{action['key']}` -> `{action['target']}` | {action['hint']} (score {action['score']})"
            )
    lines.append("")
    if isinstance(monitoring, dict):
        lines.append("## Overnight Monitoring")
        lines.append(f"- Summary: `{monitoring.get('summary_path', 'n/a')}`")
        lines.append(f"- Samples: `{monitoring.get('samples', 'n/a')}`")
        lines.append(
            f"- Window: `{monitoring.get('sample_window_start', 'n/a')}` -> `{monitoring.get('sample_window_end', 'n/a')}`"
        )
        metrics = monitoring.get("metrics")
        if isinstance(metrics, dict):
            mem_p50 = metrics.get("mem_unused_p50_mb")
            gauss_p95 = metrics.get("gauss_cpu_p95_pct")
            gpu_p95 = metrics.get("gpu_device_p95_pct")
            lines.append(
                f"- Key metrics: mem_unused p50 `{mem_p50}`MB, gauss_cpu p95 `{gauss_p95}`%, gpu_device p95 `{gpu_p95}`%"
            )
        alerts = monitoring.get("alerts") or []
        if alerts:
            lines.append("- Alerts:")
            for item in alerts:
                lines.append(f"  - {item}")
        lines.append("")

    lines.append("## Prompt Capsule")
    prompt = capsule["prompt_capsule"]
    lines.append(f"- Goal: {prompt['goal']}")
    lines.append("- Now:")
    for item in prompt["now"]:
        lines.append(f"  - {item}")
    lines.append("- Next:")
    for item in prompt["next"]:
        lines.append(f"  - {item}")
    lines.append(f"- Scope rule: {prompt['scope_rule']}")
    lines.append("")
    lines.append("## Routes")
    for route in capsule["routes"]:
        lines.append(f"- `{route}`")
    lines.append("")
    lines.append("## Critical Endpoints")
    for endpoint in capsule["critical_endpoints"]:
        lines.append(f"- `{endpoint}`")
    lines.append("")
    return "\n".join(lines)


def write_outputs(root: Path, out_dir: Path, capsule: dict[str, Any]) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = capsule["generated_at"].replace(":", "-")
    json_path = out_dir / f"{stamp}-backprop.json"
    md_path = out_dir / f"{stamp}-backprop.md"
    latest_json = out_dir / "latest-backprop.json"
    latest_md = out_dir / "latest-backprop.md"

    md = render_markdown(capsule)
    json_text = json.dumps(capsule, indent=2) + "\n"

    json_path.write_text(json_text, encoding="utf-8")
    md_path.write_text(md + "\n", encoding="utf-8")
    latest_json.write_text(json_text, encoding="utf-8")
    latest_md.write_text(md + "\n", encoding="utf-8")
    return json_path, md_path


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a compact Gauss backprop context capsule.")
    parser.add_argument("--root", type=str, default=None, help="Repository root override.")
    parser.add_argument("--output-dir", type=str, default="reports/context", help="Output directory for capsule files.")
    parser.add_argument("--max-actions", type=int, default=8, help="Maximum backprop actions to include.")
    parser.add_argument("--max-files", type=int, default=20, help="Maximum changed files to include in sample list.")
    parser.add_argument("--write", action="store_true", help="Write JSON + Markdown outputs to output-dir.")
    parser.add_argument("--short", action="store_true", help="Print one-line summary for shell hooks.")
    parser.add_argument("--print-capsule", action="store_true", help="Print compact JSON capsule to stdout.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = resolve_root(Path.cwd(), args.root)
    if not root.exists():
        print(f"error: root does not exist: {root}", file=sys.stderr)
        return 2

    git = collect_git_snapshot(root, max_files=max(1, args.max_files))
    progress = load_progress_payload(root)
    capsule = build_capsule(root, git, progress, max_actions=max(1, args.max_actions))

    json_path: Path | None = None
    md_path: Path | None = None
    if args.write:
        out_dir = Path(args.output_dir)
        if not out_dir.is_absolute():
            out_dir = root / out_dir
        json_path, md_path = write_outputs(root, out_dir, capsule)

    if args.short:
        top = capsule["prompt_capsule"]["now"]
        first = top[0] if top else "no blockers"
        print(
            f"GAUSS_BACKPROP overall={capsule['readiness']['overall']}% "
            f"branch={capsule['branch']} blockers={len(capsule['blockers'])} "
            f"next=\"{first}\""
        )
    elif args.print_capsule:
        print(json.dumps(capsule, indent=2))
    else:
        print("Gauss Backpropagation Scaffold")
        print("==============================")
        print(f"Root: {root}")
        print(f"Readiness: {capsule['readiness']['overall']}%")
        print(f"Branch: {capsule['branch']}")
        print(f"Blockers: {len(capsule['blockers'])}")
        if json_path and md_path:
            print(f"JSON: {json_path}")
            print(f"Markdown: {md_path}")
        else:
            print("Tip: use --write to persist capsule under reports/context.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
