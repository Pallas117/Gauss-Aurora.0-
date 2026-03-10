# Investor Readiness Scan (2026-03-06)

## Scope
- Switched backend back to normal model endpoint from `.env`:
  - `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions`
  - `GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1`
- Ran technical debt / stability / compliance checks.
- Verified core backend health and command pipeline status.

## Scan Results
- `npm run lint`: PASS
- `npm run build`: PASS
  - Build warning: very large production chunks.
  - Largest chunks:
    - `dist/assets/three-core-vendor-*.js` ~683 kB
    - `dist/assets/vendor-*.js` ~508 kB
- `npm test`: PASS (98/98)
- `npm run scan:backend-lint`: PASS (`reports/progress/backend-lint-issues.json` has zero issues)
- `npm run check:security-compliance`: PASS (8 pass, 0 warn, 0 fail)
- `npm run progress:short`: PASS (`GAUSS_PROGRESS overall=100%`)
- `npm run test:unit:ui -- src/components/__tests__/CommandPage.test.tsx`: PASS (2/2)
- `npm run release:check`: PASS
  - Full adherence audit summary: `PASS=11`, `WARN=0`, `FAIL=0`, `SKIP=3`
  - Skips are expected in this environment (RBAC credential preflight/runtime + Supabase RLS smoke)

## Live Runtime Checks
- `GET /health`: PASS (`ok=true`)
- `GET /v1/models` (local normal model endpoint): PASS (`mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`)
- DeepSeek safe-command planner/executor under normal model endpoint:
  - `POST /api/ops/command/deepseek/run/plan`: PASS (`201`)
  - `POST /api/ops/command/deepseek/run/execute`: PASS (`200`)
  - Live execution sample:
    - command: `pmset -g batt`
    - result: `exit_code=0`, `execution_ok=true`
    - battery sample: `49%; charging; (no estimate) present: true`
  - Planner fallback mode engaged (`planner_fallback_used=true`) to guarantee JSON-safe command proposal when reasoning output lacks parseable command JSON.

## Hardening Applied During Prep
1. `test:orchestrator:live-ingest` now loads `.env` safely and injects stable defaults for:
   - `ORCHESTRATOR_INGEST_API_URL`
   - `ORCHESTRATOR_XTCE_PATH`
   - `ORCHESTRATOR_APID_MAP_PATH`
2. Added script: `backend/scripts/orchestrator-live-ingest.ts` to make release preflight deterministic without manual env export.

## Investor Demo Risk Assessment
### High (must fix before live investor demo)
1. Large JS bundles increase cold-load time and can impact live demo smoothness on weak networks/devices.
2. Primary model output format can be reasoning-heavy; fallback planner now mitigates this, but a deterministic model-format contract should still be finalized.

### Medium (presentation quality / resiliency)
1. Backend bind is `0.0.0.0`; acceptable for LAN demo but should be explicit in runbook and network-isolated.
2. Keep explicit fallback path documented (`dev:brain:stub` + planner fallback) in case local model startup degrades on constrained hardware.

## Go-Live Checklist (Investor Presentation)
1. Start local model:
   - `npm run dev:brain:mlx`
2. Start backend:
   - `npm run dev:proxy`
3. Verify model connectivity:
   - `POST /api/ops/command/deepseek/run/plan` returns `201`
4. Verify approval + execution flow:
   - `POST /api/ops/command/deepseek/run/execute` returns `200`
5. Run full investor preflight:
   - `npm run release:check`
6. Keep fallback command ready:
   - Fallback planner is enabled (`ORCHESTRATOR_SAFE_COMMAND_PLANNER_FALLBACK_ENABLED=true`) to preserve live demo continuity.

## Recommended Immediate Tech Debt Actions
1. Split `three`-heavy pages into route-level dynamic imports for presentation builds.
2. Add a startup readiness endpoint aggregating:
   - model reachability
   - Postgres/audit availability
   - safe-runner enabled status
3. Add one command for investor preflight:
   - lint + build + backend tests + model ping + safe-runner plan/execute smoke.
