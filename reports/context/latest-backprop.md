# Gauss Backprop Context Capsule

- Generated: `2026-03-04T06:43:06Z`
- Root: `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora`
- Branch: `2026-02-10-2ybo`
- Readiness: `96%` (velocity/day: `0.317`)
- Next incomplete milestone: `V0.2 Audit Parity`
- Backend/AI granular: 19 passed, 0 failed (19 total)
- Overnight monitoring: `overnight-20260303-232619`

## Worktree
- Dirty: `True` | modified `180`, staged `673`, untracked `48`, conflicts `0`
- Hotspots:
  - `src` (235)
  - `research` (108)
  - `backend` (97)
  - `gauss-orchestrator` (84)
  - `docs` (55)
  - `reports` (37)
  - `scripts` (24)
  - `tests` (21)

## Backprop Actions (highest leverage)
- [Runtime Efficiency] `monitoring-memory-headroom` -> `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora/playwright.config.ts` | Constrain default Playwright worker count when free RAM is low to reduce swap and UI flake. (score 28.0)
- [Runtime Efficiency] `monitoring-cpu-bursts` -> `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora/src/pages/AutomationPage.tsx` | Replace fixed polling loops with adaptive cadence tied to power/profile constraints. (score 26.0)
- [Runtime Efficiency] `monitoring-gpu-bursts` -> `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora/src/pages/SDAPage.tsx` | Use lightweight SVG SDA fallback in low-power or compact viewport sessions. (score 24.0)
- [V0.2 Audit Parity] `requirements-audit-runtime-failures` -> `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora/reports/progress/requirements-audit.latest.json` | Run `npm run audit:adherence` and fix failing gates. (score 20.0)

## Overnight Monitoring
- Summary: `/Users/josh/Documents/lightbound/Gauss/Gauss AI/Gauss Aurora/reports/monitoring/overnight-20260303-232619.summary.txt`
- Samples: `540`
- Window: `2026-03-03T23:26:19+0800` -> `2026-03-04T08:31:22+0800`
- Key metrics: mem_unused p50 `139.0`MB, gauss_cpu p95 `50.7`%, gpu_device p95 `42.0`%
- Alerts:
  - Low memory headroom overnight (mem_unused p50 139MB, <=100MB for 177 samples).
  - Gauss CPU bursts observed (p95 50.7%, spikes>=60%: 23).
  - GPU burst windows detected (device util p95 42.0%, spikes>=45%: 27).
  - Host load jitter high (1m load p95 5.82); avoid full-parallel heavy suites by default.

## Prompt Capsule
- Goal: Use this capsule as the only context primer, then request only missing file reads.
- Now:
  - Runtime Efficiency: Low free memory headroom overnight
  - Runtime Efficiency: Burst CPU spikes in monitored processes
  - Runtime Efficiency: Burst GPU load windows
- Next:
  - Constrain default Playwright worker count when free RAM is low to reduce swap and UI flake.
  - Replace fixed polling loops with adaptive cadence tied to power/profile constraints.
  - Use lightweight SVG SDA fallback in low-power or compact viewport sessions.
- Scope rule: Work only in hotspot areas unless blocker requires cross-cutting change.

## Routes
- `/`
- `/command`
- `/sda`
- `/systems`
- `/intel`
- `/heliophysics`
- `/orbit`
- `/dev-hud`
- `/admin/users`
- `/staff/portal`
- `/signup`
- `/onboarding`
- `/portal`
- `/landing`
- `*`

## Critical Endpoints
- `/api/auth/session`
- `/api/auth/onboarding`
- `/api/feed/space-weather/5s`
- `/api/feed/space-weather/latest`
- `/api/feed/mms/reconnection`
- `/api/feed/mms/reconnection/latest`
- `/api/feed/aurora/map`
- `/api/feed/sources/status`
- `/api/feed/threats/latest`
- `/api/feed/dashboard/latest`
- `/api/ops/command/latest`
- `/api/ops/command/log`
- `/api/ops/pipeline/triad/latest`
- `/api/ops/network/audit`
- `/api/ops/audit/summary`
- `/api/ops/turing/devices`
- `/api/security/cybertiger/status`

