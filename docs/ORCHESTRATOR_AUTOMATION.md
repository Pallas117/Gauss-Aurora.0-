# Orchestrator Background Automation

When **audit automation** is enabled (`ORCHESTRATOR_AUDIT_AUTOMATION_ENABLED=true`), the orchestrator runs a periodic cycle **in the background**. You can get on with your tasks; the automation only asks for your input when there are WARN/FAIL gates and approval is required for the fix phase.

**Every Telegram message** includes the **progress checker** output and **cycle timer** (⏱ Cycle: Xm Ys) so you see current milestone progress and how long the cycle has been running.

## Flow (non-human first)

1. **Pipeline phases** (optional, in order; each can be enabled/disabled via env):
   - **Orchestrator** — `npm run test:orchestrator` (Rust tests)
   - **Backend** — `npm test` (Node/TS unit and integration tests)
   - **E2E frontend** — `npm run test:ui` (Playwright; off by default)
   - **Frontend** — `npm run lint && npm run test:unit:ui` (off by default)
   - **Full codebase scan** — `npm run test:orchestrator:analyze` (off by default)

2. **Audit and reports**
   - Full adherence audit (`audit:adherence:record`) and directive audit
   - Progress summary (`progress:short`) — run **before** each Telegram send so messages include fresh progress
   - Optional backprop (`context:backprop`) if `ORCHESTRATOR_BACKPROP_AFTER_AUDIT=true`
   - Implementation report (directive implementations)

3. **Notification**
   - Each message is prefixed with **⏱ Cycle: Xm Ys | GAUSS_PROGRESS …** (timer + progress checker).
   - Summary: PASS/WARN/FAIL, security mapping, audit output. If everything passed: *"No action needed—continue with your tasks."*

4. **Human-in-the-loop only when needed**
   - If there are WARN or FAIL: permission request (approve/deny) before running the fix command and optional `/fix` workflow — **unless** auto-approve is active (see [Auto-approve until UTC](#auto-approve-until-utc)).
   - After approval (or auto-approve): fix command runs, then the **small-batch patch loop** (see [Small-batch patch loop](#small-batch-patch-loop)), then optional full codebase fix workflow (code analysis + fixes).

## Integrated scripts

| Phase / script              | Env (default)        | When it runs        | Human? |
|----------------------------|----------------------|---------------------|--------|
| Orchestrator tests         | PHASE_ORCHESTRATOR_TESTS=true | Every cycle, before audit | No |
| Backend tests              | PHASE_BACKEND_TESTS=true     | Every cycle, before audit | No |
| E2E UI (Playwright)        | PHASE_E2E_UI=false           | If enabled          | No |
| Frontend (lint + unit UI)  | PHASE_FRONTEND=false         | If enabled          | No |
| Full codebase scan         | PHASE_FULLSCAN=false         | If enabled          | No |
| `audit:adherence:record`   | —                    | Every cycle         | No |
| Directive audit            | —                    | Every cycle         | No |
| `progress:short`           | —                    | Before every Telegram message | No |
| `context:backprop`        | BACKPROP_AFTER_AUDIT | If enabled          | No |
| Implementation report      | —                    | Every cycle         | No |
| Fix command + /fix workflow | —                   | Only after approval | Yes |

## Configuration

From the **workspace root** (so `npm run …` resolves correctly):

- `ORCHESTRATOR_AUDIT_AUTOMATION_ENABLED=true` — turn on background automation
- `ORCHESTRATOR_AUDIT_INTERVAL_SECS=1800` — interval between cycles (default 30 min)
- `ORCHESTRATOR_BACKPROP_AFTER_AUDIT=true` — also run `npm run context:backprop` each cycle
- `ORCHESTRATOR_AUDIT_REQUIRE_APPROVAL=true` — require Telegram approval before running the fix phase when WARN/FAIL

**Pipeline phases** (in `gauss-orchestrator/.env` or root `.env`):

- `ORCHESTRATOR_AUTOMATION_PHASE_ORCHESTRATOR_TESTS=true` — orchestrator bug-fix gate (Rust tests)
- `ORCHESTRATOR_AUTOMATION_PHASE_BACKEND_TESTS=true` — backend bug-fix gate (npm test)
- `ORCHESTRATOR_AUTOMATION_PHASE_E2E_UI=false` — E2E frontend gate (Playwright)
- `ORCHESTRATOR_AUTOMATION_PHASE_FRONTEND=false` — frontend lint + unit tests
- `ORCHESTRATOR_AUTOMATION_PHASE_FULLSCAN=false` — full codebase scan (orchestrator code analyzer)

See `gauss-orchestrator/.env.example` for all audit automation, backprop, and phase options.

## Auto-approve until UTC

When `ORCHESTRATOR_AUTO_APPROVE_UNTIL_UTC` is set to an RFC 3339 UTC timestamp (e.g. `2026-02-28T10:00:00Z`), the orchestrator **skips the approval gate** for WARN/FAIL until that time. Before the deadline, the fix phase (fix command + patch batch loop + optional fix workflow) runs automatically and a Telegram message states that auto-approve is active until the deadline. After the deadline, behaviour reverts to requiring approval when `ORCHESTRATOR_AUDIT_REQUIRE_APPROVAL=true`. Use UTC only; convert your local time to UTC when setting the value.

## Full-codebase scan and work queue

When the **full codebase scan** phase runs (e.g. via `ORCHESTRATOR_ANALYZE_AT_STARTUP` or the fullscan phase):

- **Multi-root scan:** The code indexer runs over multiple roots from `ORCHESTRATOR_SCAN_ROOTS` (default: `./src,./gauss-orchestrator/src`). Each root is indexed and results are merged into a single codebase index and issue list.
- **Backend scan:** From the workspace root, `npm run scan:backend-lint` runs TypeScript check (`tsc --noEmit`) and writes `reports/progress/backend-lint-issues.json`. Those issues are merged into the work queue so backend items appear alongside code-analysis items.
- **Directive report merge:** `reports/progress/uncompleted-implementations.json` (from the directive implementation report) is read and converted into synthetic work-queue items (high severity, no file/line). They are merged into the same queue for visibility and batching.

The merged work queue is written to `ORCHESTRATOR_WORK_QUEUE_PATH` (default: `reports/orchestrator/work-queue.json`). Paths in the queue are workspace-relative so fixers and tools can resolve them.

## Small-batch patch loop

When the fix phase runs (after approval or auto-approve), the **patch batch loop** runs if `ORCHESTRATOR_PATCH_BATCH_LOOP_ENABLED` is true (default: true). It:

1. Reads the work queue from `ORCHESTRATOR_WORK_QUEUE_PATH`, sorts by priority (desc) and estimated minutes (asc).
2. For each batch of size `ORCHESTRATOR_PATCH_BATCH_SIZE` (default: 2), up to `ORCHESTRATOR_MAX_PATCH_BATCHES_PER_CYCLE` (default: 10) batches per cycle:
   - Applies fixes for items the CodeFixer can handle (Rust/orchestrator paths). Backend and directive items remain in the queue for visibility; backend fixes are not applied by the Rust fixer.
   - Runs `npm run context:backprop` from the workspace root.
   - Appends a one-line evaluation to `reports/context/autonomous-evaluation.jsonl` (timestamp, batch index, issues attempted/fixed, audit/progress deltas if available).
   - Sends a short Telegram summary for the batch.

This gives **self-learning**: each batch is followed by backprop and a recorded evaluation so progress deltas are visible and the capsule stays up to date. The backprop scaffold optionally reads the last line of `autonomous-evaluation.jsonl` and adds a one-line summary to the context capsule (e.g. "Last autonomous run: K patches, progress X% -> Y%").

## Testing and audit steps

The full adherence audit includes the test steps (2, 4, 5, 6, 7) and aligns with [QA_TEST_PLAN.md](QA_TEST_PLAN.md). See [AUDIT_STEPS.md](AUDIT_STEPS.md) for the full list of 11 steps.
