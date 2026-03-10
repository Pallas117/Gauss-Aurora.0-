#!/usr/bin/env python3
"""Gauss progress checker.

Features:
- Repository-root aware (works from any subdirectory).
- Weighted milestone scoring for V0.1 -> V0.5.
- Multiple output modes: rich bars, short one-line, JSON.
- Optional threshold failure for CI/automation.
- Requirement kinds for richer checks (files, npm scripts, text guards).
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class Requirement:
    key: str
    target: str
    label: str
    hint: str
    kind: str = "file"  # file | dir | any | glob | npm_script | text
    pattern: str | None = None


@dataclass(frozen=True)
class Milestone:
    name: str
    goal: str
    weight: float
    requirements: tuple[Requirement, ...]


MILESTONES: tuple[Milestone, ...] = (
    Milestone(
        "V0.1 Foundation",
        "Core app + backend + ingestion scaffold exist and are runnable.",
        1.0,
        (
            Requirement(
                key="repo-node-package",
                target="package.json",
                label="Node package manifest exists",
                hint="Keep dependency and script declarations versioned.",
            ),
            Requirement(
                key="frontend-entry",
                target="src/main.tsx",
                label="Frontend entrypoint exists",
                hint="Required for build and app bootstrap.",
            ),
            Requirement(
                key="frontend-app-root",
                target="src/App.tsx",
                label="App root component exists",
                hint="Keep canonical route shell in this component tree.",
            ),
            Requirement(
                key="backend-server",
                target="backend/server.ts",
                label="Backend proxy/API server exists",
                hint="Needed for feed proxy, auth, and protected endpoints.",
            ),
            Requirement(
                key="ingest-loop",
                target="backend/worker/ingest-loop.ts",
                label="Ingestion worker exists",
                hint="Worker drives 5s canonical feed lifecycle.",
            ),
            Requirement(
                key="supabase-pipeline-migration",
                target="supabase/migrations/20260217120000_space_weather_pipeline.sql",
                label="Space-weather schema migration exists",
                hint="Apply migration in Supabase before runtime checks.",
            ),
        ),
    ),
    Milestone(
        "V0.2 Audit Parity",
        "Requirements-audit gates are codified so a V0.2 pass matches release checks.",
        1.0,
        (
            Requirement(
                key="script-lint",
                target="lint",
                kind="npm_script",
                label="`npm run lint` script exists",
                hint="Must run TypeScript static checks.",
            ),
            Requirement(
                key="script-test",
                target="test",
                kind="npm_script",
                label="`npm test` script exists",
                hint="Unit/integration backend tests required by audit.",
            ),
            Requirement(
                key="script-build",
                target="build",
                kind="npm_script",
                label="`npm run build` script exists",
                hint="Production build gate must be present.",
            ),
            Requirement(
                key="script-backend-env",
                target="check:backend-env",
                kind="npm_script",
                label="`npm run check:backend-env` script exists",
                hint="Environment sanity gate required for release readiness.",
            ),
            Requirement(
                key="script-security-compliance",
                target="check:security-compliance",
                kind="npm_script",
                label="`npm run check:security-compliance` script exists",
                hint="Maps controls for security baseline checks.",
            ),
            Requirement(
                key="script-audit-adherence",
                target="audit:adherence",
                kind="npm_script",
                label="`npm run audit:adherence` script exists",
                hint="Primary requirements-audit command for V0.2 pass.",
            ),
            Requirement(
                key="script-rbac-smoke",
                target="test:rbac",
                kind="npm_script",
                label="`npm run test:rbac` script exists",
                hint="Runtime auth/RBAC validation path must be available.",
            ),
            Requirement(
                key="audit-orchestrator",
                target="backend/scripts/full-adherence-audit.ts",
                label="Full adherence audit runner exists",
                hint="This script should execute lint/test/build/env/security/RBAC checks.",
            ),
            Requirement(
                key="security-check-script",
                target="backend/scripts/security-compliance-check.ts",
                label="Security compliance check script exists",
                hint="Provides NIST/ISO mapping evidence for security gates.",
            ),
            Requirement(
                key="release-checklist",
                target="docs/RELEASE_CHECKLIST.md",
                label="Release checklist documents gate policy",
                hint="Keep release criteria aligned with audit command outputs.",
            ),
            Requirement(
                key="script-network-management",
                target="check:network-management",
                kind="npm_script",
                label="check:network-management script exists",
                hint="DTN+ISL network-management audit must be callable from release checks.",
            ),
            Requirement(
                key="network-management-audit-script",
                target="backend/scripts/network-management-audit.ts",
                label="DTN+ISL network-management audit script exists",
                hint="Required to verify disruption-tolerant routing and link controls.",
            ),
        ),
    ),
    Milestone(
        "V0.3 Local AI",
        "Optimized internal AI path is wired for local inference and threat fusion.",
        1.0,
        (
            Requirement(
                key="probability-gate",
                target="backend/ml-client/probability-gate.ts",
                label="Probability pre-inference gate exists",
                hint="Gate should decide TRIGGER_LLM vs LOG_AND_SLEEP.",
            ),
            Requirement(
                key="probability-fusion",
                target="backend/ml-client/probability-fusion.ts",
                label="Threat fusion engine exists",
                hint="Fusion output should include factors and confidence intervals.",
            ),
            Requirement(
                key="probability-gate-tests",
                target="backend/ml-client/probability-gate.test.ts",
                label="Probability gate has tests",
                hint="Add/maintain tests for edge cases and thresholds.",
            ),
            Requirement(
                key="probability-fusion-tests",
                target="backend/ml-client/probability-fusion.test.ts",
                label="Threat fusion has tests",
                hint="Add tests for ordering and actionability decisions.",
            ),
            Requirement(
                key="brain-stub-script-file",
                target="backend/scripts/gauss-brain-stub.ts",
                label="Local brain stub script exists",
                hint="Use this for local pipeline validation before full model rollout.",
            ),
            Requirement(
                key="brain-stub-npm-script",
                target="dev:brain:stub",
                kind="npm_script",
                label="`npm run dev:brain:stub` script exists",
                hint="Required to validate local AI endpoint contract.",
            ),
            Requirement(
                key="full-stack-mission-script",
                target="backend/scripts/full-stack-mission.ts",
                label="Full-stack mission validation script exists",
                hint="Used to verify end-to-end readiness gates.",
            ),
            Requirement(
                key="full-stack-brain-url-config",
                target="backend/scripts/full-stack-mission.ts",
                kind="text",
                pattern="GAUSS_BRAIN_URL",
                label="Full-stack mission script references GAUSS_BRAIN_URL",
                hint="Keep model endpoint configurable for local/cloud modes.",
            ),
            Requirement(
                key="infer-server",
                target="ml/infer/infer_server.py",
                label="Inference server exists",
                hint="Host optimized model inference endpoint locally.",
            ),
            Requirement(
                key="training-pipeline",
                target="ml/train/train_unet.py",
                label="Training pipeline exists",
                hint="Needed for model refresh and retraining cadence.",
            ),
        ),
    ),
    Milestone(
        "V0.4 Mesh Security",
        "System can run securely over Tailscale mesh/public networks with hardened defaults.",
        1.0,
        (
            Requirement(
                key="tailscale-dev-script-file",
                target="scripts/tailscale/dev-mobile.sh",
                label="Tailscale dev launcher exists",
                hint="Use for mesh-network development sessions.",
            ),
            Requirement(
                key="tailscale-doctor-file",
                target="scripts/tailscale/doctor.sh",
                label="Tailscale doctor script exists",
                hint="Doctor should validate secure mobile/public Wi-Fi posture.",
            ),
            Requirement(
                key="tailscale-dev-npm-script",
                target="dev:tailscale",
                kind="npm_script",
                label="`npm run dev:tailscale` script exists",
                hint="Must provide secure mesh-network startup path.",
            ),
            Requirement(
                key="tailscale-doctor-npm-script",
                target="dev:tailscale:doctor",
                kind="npm_script",
                label="`npm run dev:tailscale:doctor` script exists",
                hint="Required preflight check before mobile/public network dev.",
            ),
            Requirement(
                key="tailscale-doctor-fix-npm-script",
                target="dev:tailscale:doctor:fix",
                kind="npm_script",
                label="`npm run dev:tailscale:doctor:fix` script exists",
                hint="Should remediate stale port collisions quickly.",
            ),
            Requirement(
                key="tailscale-auth-guard",
                target="scripts/tailscale/dev-mobile.sh",
                kind="text",
                pattern="AUTH_REQUIRED=false",
                label="Tailscale path blocks insecure AUTH_REQUIRED=false mode",
                hint="Keep auth enabled on mobile/public network sessions.",
            ),
            Requirement(
                key="tailscale-cybertiger-guard",
                target="scripts/tailscale/dev-mobile.sh",
                kind="text",
                pattern="CYBERTIGER_ENABLED=false",
                label="Tailscale path blocks disabling CyberTiger",
                hint="Do not allow unprotected runtime on public links.",
            ),
            Requirement(
                key="backend-auth",
                target="backend/auth.ts",
                label="Backend auth middleware exists",
                hint="Role checks should gate protected APIs and WebSockets.",
            ),
            Requirement(
                key="cybertiger-daemon",
                target="backend/cybertiger/daemon.ts",
                label="CyberTiger daemon exists",
                hint="Ensure rate-limit and abuse protections stay enabled.",
            ),
            Requirement(
                key="security-baseline-doc",
                target="docs/CYBERTIGER_COMPLIANCE_BASELINE.md",
                label="Security baseline document exists",
                hint="Track NIST/ISO mappings and control status.",
            ),
        ),
    ),
    Milestone(
        "V0.5 Offline Ops",
        "Mission remains operational when cloud is degraded: local model + mesh + offline data continuity.",
        1.0,
        (
            Requirement(
                key="state-fallback-buffer",
                target="backend/state.ts",
                label="In-memory state fallback exists",
                hint="Used when remote stores are stale or unavailable.",
            ),
            Requirement(
                key="frontend-fallback-model",
                target="src/lib/dataProcessing.ts",
                label="Frontend data model supports live/cache/fallback states",
                hint="Operator must see degraded-mode context clearly.",
            ),
            Requirement(
                key="offline-goal-service-worker",
                target="docs/DATA_FETCHING_OPTIMIZATION.md",
                kind="text",
                pattern="Service Worker for offline caching",
                label="Offline caching goal documented (service worker)",
                hint="Implement service worker + registration in app shell.",
            ),
            Requirement(
                key="offline-goal-indexeddb",
                target="docs/DATA_FETCHING_OPTIMIZATION.md",
                kind="text",
                pattern="IndexedDB for persistent cache storage",
                label="Persistent offline cache goal documented (IndexedDB)",
                hint="Implement persistent cache for feed continuity.",
            ),
            Requirement(
                key="offline-sw-implementation",
                target="public/offline-sw.js",
                label="Offline service worker implemented",
                hint="Add `public/offline-sw.js` and register from frontend bootstrap.",
            ),
            Requirement(
                key="offline-cache-layer",
                target="src/lib/offline/offline-cache.ts",
                label="Offline cache layer implemented",
                hint="Create IndexedDB/local cache adapter for key feeds.",
            ),
            Requirement(
                key="offline-status-hook",
                target="src/hooks/useOfflineMode.ts",
                label="Offline mode hook implemented",
                hint="Expose online/offline + stale-data status for UI actions.",
            ),
            Requirement(
                key="fullstack-validation-script",
                target="test:fullstack",
                kind="npm_script",
                label="`npm run test:fullstack` script exists",
                hint="Use this gate to validate mesh + local AI + DB + UI behavior.",
            ),
            Requirement(
                key="v05-python-engine-tests",
                target="tests/unit/test_engine.py",
                label="Probability engine Python tests exist",
                hint="Maintain >=90% coverage on mission probability engine module.",
            ),
        ),
    ),
)


@dataclass
class MissingRequirement:
    key: str
    label: str
    target: str
    hint: str


@dataclass
class EvalContext:
    npm_scripts: set[str]


@dataclass
class RequirementsAuditEvidence:
    path: Path
    generated_at: str
    pass_count: int
    warn_count: int
    fail_count: int
    total: int
    score: int
    age_hours: float
    stale: bool


@dataclass
class RequirementsAuditStatus:
    report_path: Path
    evidence: RequirementsAuditEvidence | None
    issue: str | None


def _load_package_json_scripts(root: Path) -> set[str]:
    package_json_path = root / "package.json"
    if not package_json_path.is_file():
        return set()

    try:
        parsed = json.loads(package_json_path.read_text(encoding="utf-8"))
    except Exception:
        return set()

    scripts = parsed.get("scripts")
    if not isinstance(scripts, dict):
        return set()

    output: set[str] = set()
    for key in scripts.keys():
        if isinstance(key, str):
            output.add(key)
    return output


def build_eval_context(root: Path) -> EvalContext:
    return EvalContext(npm_scripts=_load_package_json_scripts(root))


class Colors:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.RESET = "\033[0m" if enabled else ""
        self.BOLD = "\033[1m" if enabled else ""
        self.DIM = "\033[90m" if enabled else ""
        self.OK = "\033[92m" if enabled else ""
        self.WARN = "\033[93m" if enabled else ""
        self.BAD = "\033[91m" if enabled else ""


@dataclass
class MilestoneResult:
    name: str
    goal: str
    score: int
    found: int
    total: int
    missing: list[MissingRequirement]
    note: str | None = None


@dataclass
class HistoryRun:
    generated_at: str
    overall: int
    path: Path


@dataclass
class Velocity:
    previous_timestamp: str
    previous_overall: int
    current_overall: int
    delta_points: int
    days_elapsed: float
    points_per_day: float


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gauss milestone progress checker")
    parser.add_argument("--root", type=str, default=None, help="Repository root override")
    parser.add_argument(
        "--audit-report",
        type=str,
        default="reports/progress/requirements-audit.latest.json",
        help="Requirements-audit report path (relative to root unless absolute).",
    )
    parser.add_argument(
        "--audit-max-age-hours",
        type=float,
        default=24.0,
        help="Max age in hours before requirements-audit evidence is considered stale.",
    )
    parser.add_argument(
        "--refresh-audit",
        action="store_true",
        help="Refresh requirements-audit report via `npm run audit:adherence:record` before scoring.",
    )
    parser.add_argument("--short", action="store_true", help="Print single-line summary")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Print JSON payload")
    parser.add_argument("--show-missing", action="store_true", help="Show missing requirements in full mode")
    parser.add_argument(
        "--record-history",
        action="store_true",
        help="Persist this run to history under reports/progress",
    )
    parser.add_argument(
        "--history-dir",
        type=str,
        default="reports/progress",
        help="History output directory, relative to repo root unless absolute",
    )
    parser.add_argument(
        "--history-limit",
        type=int,
        default=200,
        help="Maximum history report files to retain",
    )
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    parser.add_argument(
        "--fail-under",
        type=int,
        default=None,
        help="Exit non-zero if overall completion is below this percentage",
    )
    return parser.parse_args(argv)


def resolve_repo_root(start: Path, explicit_root: str | None) -> Path:
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start,
            check=True,
            capture_output=True,
            text=True,
        )
        root = result.stdout.strip()
        if root:
            return Path(root).resolve()
    except Exception:
        pass

    probe = start.resolve()
    for candidate in [probe, *probe.parents]:
        if (candidate / "package.json").is_file() and (candidate / "backend").exists():
            return candidate

    return start.resolve()


def resolve_requirements_audit_report_path(root: Path, audit_report_arg: str) -> Path:
    candidate = Path(audit_report_arg).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (root / candidate).resolve()


def _parse_requirements_audit_counts(parsed: dict) -> tuple[int, int, int]:
    totals = parsed.get("totals")
    if isinstance(totals, dict):
        passed = totals.get("pass")
        warned = totals.get("warn")
        failed = totals.get("fail")
        if isinstance(passed, int) and isinstance(warned, int) and isinstance(failed, int):
            return passed, warned, failed

    checks = parsed.get("checks")
    if isinstance(checks, list):
        passed = 0
        warned = 0
        failed = 0
        for check in checks:
            if not isinstance(check, dict):
                continue
            status = check.get("status")
            if status == "PASS":
                passed += 1
            elif status == "WARN":
                warned += 1
            elif status == "FAIL":
                failed += 1
        return passed, warned, failed

    return 0, 0, 0


def load_requirements_audit_status(
    root: Path,
    audit_report_arg: str,
    max_age_hours: float,
) -> RequirementsAuditStatus:
    report_path = resolve_requirements_audit_report_path(root, audit_report_arg)
    if not report_path.is_file():
        return RequirementsAuditStatus(
            report_path=report_path,
            evidence=None,
            issue="requirements-audit report missing",
        )

    try:
        parsed = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("invalid requirements-audit JSON payload")
    except Exception as exc:
        return RequirementsAuditStatus(
            report_path=report_path,
            evidence=None,
            issue=f"unable to parse requirements-audit report: {exc}",
        )

    generated_at = parsed.get("generated_at")
    if not isinstance(generated_at, str):
        generated_at = datetime.fromtimestamp(report_path.stat().st_mtime, tz=timezone.utc).isoformat()

    try:
        generated_dt = parse_iso_utc(generated_at)
    except Exception:
        generated_dt = datetime.fromtimestamp(report_path.stat().st_mtime, tz=timezone.utc)
        generated_at = generated_dt.isoformat().replace("+00:00", "Z")

    passed, warned, failed = _parse_requirements_audit_counts(parsed)
    total = passed + warned + failed
    if total <= 0:
        return RequirementsAuditStatus(
            report_path=report_path,
            evidence=None,
            issue="requirements-audit report has no check totals",
        )

    weighted = passed + (0.5 * warned)
    runtime_score = int(round((weighted / total) * 100))
    age_hours = max(0.0, (datetime.now(timezone.utc) - generated_dt).total_seconds() / 3600.0)
    stale = age_hours > max(0.0, max_age_hours)

    evidence = RequirementsAuditEvidence(
        path=report_path,
        generated_at=generated_at,
        pass_count=passed,
        warn_count=warned,
        fail_count=failed,
        total=total,
        score=runtime_score,
        age_hours=age_hours,
        stale=stale,
    )
    return RequirementsAuditStatus(report_path=report_path, evidence=evidence, issue=None)


def refresh_requirements_audit(root: Path) -> tuple[bool, str | None]:
    proc = subprocess.run(
        ["npm", "run", "audit:adherence:record"],
        cwd=root,
        text=True,
        capture_output=True,
    )
    if proc.returncode == 0:
        return True, None

    output = f"{proc.stdout or ''}\n{proc.stderr or ''}".strip()
    if len(output) > 300:
        output = output[:300] + "...<truncated>"
    return False, f"refresh failed: {output or f'exit={proc.returncode}'}"


def _dedupe_missing(items: list[MissingRequirement]) -> list[MissingRequirement]:
    seen: set[str] = set()
    output: list[MissingRequirement] = []
    for item in items:
        if item.key in seen:
            continue
        seen.add(item.key)
        output.append(item)
    return output


def align_results_with_requirements_audit(
    results: list[MilestoneResult],
    status: RequirementsAuditStatus,
) -> list[MilestoneResult]:
    aligned: list[MilestoneResult] = []
    for result in results:
        if not result.name.startswith("V0.2"):
            aligned.append(result)
            continue

        missing = list(result.missing)
        score = result.score
        notes: list[str] = []

        if status.evidence is None:
            score = min(score, 60)
            missing.append(
                MissingRequirement(
                    key="requirements-audit-evidence",
                    label="Fresh requirements-audit evidence missing",
                    target=str(status.report_path),
                    hint="Run `npm run audit:adherence:record` to update V0.2 scoring evidence.",
                )
            )
            if status.issue:
                notes.append(status.issue)
        else:
            evidence = status.evidence
            runtime_score = evidence.score
            if evidence.stale:
                runtime_score = min(runtime_score, 70)
                notes.append(
                    f"requirements-audit stale ({evidence.age_hours:.1f}h old; max configured window exceeded)"
                )

            score = min(score, runtime_score)
            notes.append(
                "runtime audit "
                f"PASS/WARN/FAIL={evidence.pass_count}/{evidence.warn_count}/{evidence.fail_count} "
                f"(score={evidence.score}%, source={evidence.path})"
            )

            # Step 8: Security compliance mapping (from embedded security_compliance in audit report)
            try:
                raw = status.report_path.read_text(encoding="utf-8")
                payload = json.loads(raw)
                if isinstance(payload, dict):
                    sc = payload.get("security_compliance")
                    if isinstance(sc, dict):
                        tot = sc.get("totals")
                        if isinstance(tot, dict):
                            sp = tot.get("pass", 0) or 0
                            sw = tot.get("warn", 0) or 0
                            sf = tot.get("fail", 0) or 0
                            notes.append(
                                f"Security mapping (Step 8): {sp} pass, {sw} warn, {sf} fail"
                            )
                            if isinstance(sf, (int, float)) and int(sf) > 0:
                                missing.append(
                                    MissingRequirement(
                                        key="security-compliance-failures",
                                        label="Security compliance mapping has failing controls",
                                        target=str(status.report_path),
                                        hint="Run `npm run audit:adherence` and fix failing NIST/ISO controls.",
                                    )
                                )
                                score = min(score, 85)
            except Exception:
                pass

            if evidence.fail_count > 0:
                missing.append(
                    MissingRequirement(
                        key="requirements-audit-runtime-failures",
                        label="Runtime requirements audit currently failing",
                        target=str(evidence.path),
                        hint="Run `npm run audit:adherence` and fix failing gates.",
                    )
                )
            elif evidence.warn_count > 0:
                missing.append(
                    MissingRequirement(
                        key="requirements-audit-runtime-warnings",
                        label="Runtime requirements audit has warnings",
                        target=str(evidence.path),
                        hint="Resolve warning checks to reach full V0.2 pass.",
                    )
                )

        aligned.append(
            MilestoneResult(
                name=result.name,
                goal=result.goal,
                score=score,
                found=result.found,
                total=result.total,
                missing=_dedupe_missing(missing),
                note="; ".join(notes) if notes else result.note,
            )
        )

    return aligned


def requirement_exists(root: Path, requirement: Requirement, context: EvalContext) -> bool:
    if requirement.kind == "npm_script":
        return requirement.target in context.npm_scripts

    target = root / requirement.target
    if requirement.kind == "file":
        return target.is_file()
    if requirement.kind == "dir":
        return target.is_dir()
    if requirement.kind == "any":
        return target.exists()
    if requirement.kind == "glob":
        return any(root.glob(requirement.target))
    if requirement.kind == "text":
        if not target.is_file() or not requirement.pattern:
            return False
        try:
            return requirement.pattern in target.read_text(encoding="utf-8")
        except Exception:
            return False
    return target.exists()


def evaluate(root: Path, milestones: Iterable[Milestone]) -> tuple[list[MilestoneResult], int]:
    context = build_eval_context(root)
    results: list[MilestoneResult] = []
    weighted_sum = 0.0
    total_weight = 0.0

    for milestone in milestones:
        missing: list[MissingRequirement] = []
        found = 0
        for req in milestone.requirements:
            if requirement_exists(root, req, context):
                found += 1
            else:
                missing.append(
                    MissingRequirement(
                        key=req.key,
                        label=req.label,
                        target=req.target,
                        hint=req.hint,
                    )
                )
        total = len(milestone.requirements)
        score = int(round((found / total) * 100)) if total else 100
        results.append(
            MilestoneResult(
                name=milestone.name,
                goal=milestone.goal,
                score=score,
                found=found,
                total=total,
                missing=missing,
            )
        )
        weighted_sum += score * milestone.weight
        total_weight += milestone.weight

    overall = int(round(weighted_sum / total_weight)) if total_weight else 0
    return results, overall


def recompute_weighted_overall(results: list[MilestoneResult], milestones: Iterable[Milestone]) -> int:
    weights = {milestone.name: milestone.weight for milestone in milestones}
    weighted_sum = 0.0
    total_weight = 0.0
    for result in results:
        weight = weights.get(result.name, 1.0)
        weighted_sum += result.score * weight
        total_weight += weight
    return int(round(weighted_sum / total_weight)) if total_weight else 0


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def sanitize_filename_timestamp(timestamp: str) -> str:
    return timestamp.replace(":", "-")


def resolve_history_dir(root: Path, history_dir_arg: str) -> Path:
    candidate = Path(history_dir_arg).expanduser()
    if candidate.is_absolute():
        return candidate
    return (root / candidate).resolve()


def build_payload(
    root: Path,
    generated_at: str,
    results: list[MilestoneResult],
    overall: int,
    velocity: Velocity | None,
    history_path: Path | None,
    requirements_audit: RequirementsAuditStatus | None,
) -> dict:
    payload = {
        "root": str(root),
        "generated_at": generated_at,
        "overall": overall,
        "milestones": [
            {
                "name": r.name,
                "goal": r.goal,
                "score": r.score,
                "found": r.found,
                "total": r.total,
                "note": r.note,
                "missing": [
                    {
                        "key": missing.key,
                        "label": missing.label,
                        "target": missing.target,
                        "hint": missing.hint,
                    }
                    for missing in r.missing
                ],
            }
            for r in results
        ],
    }
    if requirements_audit:
        evidence = requirements_audit.evidence
        payload["requirements_audit"] = {
            "report_path": str(requirements_audit.report_path),
            "issue": requirements_audit.issue,
            "evidence": (
                {
                    "generated_at": evidence.generated_at,
                    "pass": evidence.pass_count,
                    "warn": evidence.warn_count,
                    "fail": evidence.fail_count,
                    "total": evidence.total,
                    "score": evidence.score,
                    "age_hours": round(evidence.age_hours, 2),
                    "stale": evidence.stale,
                    "path": str(evidence.path),
                }
                if evidence
                else None
            ),
        }
    if velocity:
        payload["velocity"] = {
            "previous_timestamp": velocity.previous_timestamp,
            "previous_overall": velocity.previous_overall,
            "current_overall": velocity.current_overall,
            "delta_points": velocity.delta_points,
            "days_elapsed": round(velocity.days_elapsed, 4),
            "points_per_day": round(velocity.points_per_day, 3),
        }
    if history_path:
        payload["history_report"] = str(history_path)
    return payload


def load_history_runs(history_dir: Path) -> list[HistoryRun]:
    if not history_dir.is_dir():
        return []

    runs: list[HistoryRun] = []
    for path in sorted(history_dir.glob("*-report.json")):
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
            generated_at = parsed.get("generated_at")
            overall = parsed.get("overall")
            if not isinstance(generated_at, str):
                continue
            if not isinstance(overall, int):
                continue
            # Validate parseability.
            parse_iso_utc(generated_at)
            runs.append(HistoryRun(generated_at=generated_at, overall=overall, path=path))
        except Exception:
            continue

    runs.sort(key=lambda item: parse_iso_utc(item.generated_at))
    return runs


def compute_velocity(previous: HistoryRun | None, generated_at: str, overall: int) -> Velocity | None:
    if previous is None:
        return None

    current_dt = parse_iso_utc(generated_at)
    previous_dt = parse_iso_utc(previous.generated_at)
    elapsed_seconds = (current_dt - previous_dt).total_seconds()
    if elapsed_seconds <= 0:
        return None

    days_elapsed = elapsed_seconds / 86400.0
    delta_points = overall - previous.overall
    return Velocity(
        previous_timestamp=previous.generated_at,
        previous_overall=previous.overall,
        current_overall=overall,
        delta_points=delta_points,
        days_elapsed=days_elapsed,
        points_per_day=(delta_points / days_elapsed),
    )


def write_history_report(
    history_dir: Path,
    generated_at: str,
    payload: dict,
    history_limit: int,
) -> Path:
    history_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{sanitize_filename_timestamp(generated_at)}-report.json"
    report_path = history_dir / filename
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    if history_limit > 0:
        files = sorted(history_dir.glob("*-report.json"))
        overflow = len(files) - history_limit
        if overflow > 0:
            for stale_path in files[:overflow]:
                try:
                    stale_path.unlink()
                except OSError:
                    pass

    return report_path


def bar(score: int, width: int = 28) -> str:
    filled = int(round(width * (score / 100)))
    return "#" * filled + "-" * (width - filled)


def print_full(
    root: Path,
    results: list[MilestoneResult],
    overall: int,
    colors: Colors,
    show_missing: bool,
    velocity: Velocity | None,
    history_path: Path | None,
) -> None:
    print(f"{colors.BOLD}GAUSS Progress Monitor{colors.RESET}")
    print(f"{colors.DIM}root: {root}{colors.RESET}")
    print("")

    for result in results:
        score_color = colors.OK if result.score >= 80 else colors.WARN if result.score >= 50 else colors.BAD
        print(
            f"{colors.BOLD}{result.name:<15}{colors.RESET} "
            f"[{score_color}{bar(result.score)}{colors.RESET}] {score_color}{result.score:>3}%{colors.RESET} "
            f"({result.found}/{result.total})"
        )
        print(f"  {colors.DIM}goal: {result.goal}{colors.RESET}")
        if result.note:
            print(f"  {colors.DIM}note: {result.note}{colors.RESET}")
        if show_missing and result.missing:
            for miss in result.missing:
                print(f"  {colors.DIM}missing[{miss.key}]: {miss.label}{colors.RESET}")
                print(f"  {colors.DIM}  target: {miss.target}{colors.RESET}")
                print(f"  {colors.DIM}  next: {miss.hint}{colors.RESET}")

    print("")
    overall_color = colors.OK if overall >= 80 else colors.WARN if overall >= 50 else colors.BAD
    print(f"{colors.BOLD}Mission readiness:{colors.RESET} {overall_color}{overall}%{colors.RESET}")
    if velocity:
        direction = "+" if velocity.points_per_day >= 0 else ""
        print(
            f"{colors.BOLD}Velocity:{colors.RESET} "
            f"{direction}{velocity.points_per_day:.2f} pts/day "
            f"(Δ {velocity.delta_points:+d} since {velocity.previous_timestamp})"
        )
    if history_path:
        print(f"{colors.DIM}history report: {history_path}{colors.RESET}")


def print_short(results: list[MilestoneResult], overall: int, velocity: Velocity | None) -> None:
    parts = [f"overall={overall}%"]
    for result in results:
        level = result.name.split()[0]
        parts.append(f"{level}={result.score}%")
    if velocity:
        parts.append(f"velocity_day={velocity.points_per_day:+.2f}")
    print("GAUSS_PROGRESS " + " ".join(parts))


def print_json(payload: dict) -> None:
    print(json.dumps(payload, indent=2))


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    root = resolve_repo_root(Path.cwd(), args.root)

    if not root.exists():
        print(f"error: root path does not exist: {root}", file=sys.stderr)
        return 2

    refresh_issue: str | None = None
    if args.refresh_audit:
        refreshed, refresh_issue = refresh_requirements_audit(root)
        if not refreshed and refresh_issue is None:
            refresh_issue = "requirements-audit refresh failed"

    requirements_audit = load_requirements_audit_status(
        root=root,
        audit_report_arg=args.audit_report,
        max_age_hours=float(args.audit_max_age_hours),
    )
    if refresh_issue:
        combined_issue = refresh_issue
        if requirements_audit.issue:
            combined_issue = f"{requirements_audit.issue}; {refresh_issue}"
        requirements_audit = RequirementsAuditStatus(
            report_path=requirements_audit.report_path,
            evidence=requirements_audit.evidence,
            issue=combined_issue,
        )

    results, _ = evaluate(root, MILESTONES)
    results = align_results_with_requirements_audit(results, requirements_audit)
    overall = recompute_weighted_overall(results, MILESTONES)
    generated_at = now_iso_utc()
    history_dir = resolve_history_dir(root, args.history_dir)
    history_runs = load_history_runs(history_dir)
    previous = history_runs[-1] if history_runs else None
    velocity = compute_velocity(previous, generated_at, overall)
    history_path: Path | None = None
    payload = build_payload(
        root=root,
        generated_at=generated_at,
        results=results,
        overall=overall,
        velocity=velocity,
        history_path=None,
        requirements_audit=requirements_audit,
    )

    if args.record_history:
        history_path = write_history_report(
            history_dir=history_dir,
            generated_at=generated_at,
            payload=payload,
            history_limit=max(1, int(args.history_limit)),
        )
        payload = build_payload(
            root=root,
            generated_at=generated_at,
            results=results,
            overall=overall,
            velocity=velocity,
            history_path=history_path,
            requirements_audit=requirements_audit,
        )

    color_enabled = (
        not args.no_color
        and os.environ.get("NO_COLOR") is None
        and sys.stdout.isatty()
    )
    colors = Colors(color_enabled)

    if args.as_json:
        print_json(payload)
    elif args.short:
        print_short(results, overall, velocity)
    else:
        print_full(
            root,
            results,
            overall,
            colors,
            show_missing=args.show_missing,
            velocity=velocity,
            history_path=history_path,
        )

    if args.fail_under is not None and overall < args.fail_under:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
