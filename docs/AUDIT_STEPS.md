# Full Adherence Audit Steps

The full adherence audit (`npm run audit:adherence` or `npm run audit:adherence:record`) runs the following steps in the order listed in the table (1–13). The full-adherence audit script runs the steps in the order listed in the table; the script (`backend/scripts/full-adherence-audit.ts`) is the single source of truth for this order. The audit writes `reports/progress/requirements-audit.latest.json` when run with `--json-out`; the orchestrator and progress checker consume this report.

**Step 8** is the **Security Compliance Mapping** check: it produces a machine-readable control mapping (NIST/ISO/space) and feeds into the orchestrator audit summary and progress evaluation. See [CYBERTIGER_COMPLIANCE_BASELINE.md](CYBERTIGER_COMPLIANCE_BASELINE.md) and `backend/scripts/security-compliance-check.ts`.

| Step | Check |
|------|-------|
| 1 | RBAC Environment Preflight |
| 2 | RBAC Runtime Smoke Test |
| 3 | TypeScript Lint |
| 4 | Unit/Integration Tests |
| 5 | Orchestrator Tests |
| 6 | Orchestrator ingest E2E (or SKIP if token unset) |
| 7 | Orchestrator live ingest (one file) (or SKIP if token unset) |
| **8** | **Security Compliance Mapping Check** |
| 8.5 | Directive adherence (Python GC + lazy load) |
| 9 | Production Build |
| 10 | Backend Environment Sanity |
| 11 | Supabase RLS Smoke (or SKIP if Supabase/anon key/viewer creds unset) |
| 12 | DTN+ISL Network Management Audit |
| 13 | Demand Features Audit |

Security compliance (Step 8) outputs `reports/progress/security-compliance.latest.json` when run via the full audit or `npm run check:security-compliance:record`. That report is embedded in the main audit payload as `security_compliance` for orchestrator and progress evaluation.

## Testing

Steps **2**, **4**, **5**, **6**, and **7** are test-execution gates (RBAC smoke, unit/integration, orchestrator, ingest E2E, live ingest). They align with the quality and release strategy in [QA_TEST_PLAN.md](QA_TEST_PLAN.md). For frontend E2E and manual QA, run the scenarios in that document; the full adherence audit does not run Playwright or other UI tests—use `npm run test:ui` or CI for that.

**Granular UI/UX:** A per-route, per-area Playwright suite is run by the test orchestrator: `npm run test:sweep` (full E2E sweep) or `npm run test:orchestrator:power` (legacy path) both run the granular UI/UX spec after the main Playwright run. The full sweep also runs the network transition scenario (`tests/e2e/network-transition.spec.ts`) so hotspot/offline handover is included in regression coverage. To run only the granular suite: `npm run test:ui:granular`. With `UI_UX_REPORT_JSON=true`, Playwright writes a JSON report to `reports/progress/ui-ux-granular.latest.json` for progress/audit consumption.

**Granular Backend/AI:** A per-area, per-endpoint backend and AI test suite is run by the test orchestrator after backend unit tests: `npm run test:sweep` runs the granular backend+AI spec when the backend is reachable. To run only the granular backend suite: `npm run test:backend:granular` (set `BACKEND_BASE_URL` if the backend is not on `http://127.0.0.1:3001`). If the backend is not running, live API tests are skipped and the suite exits successfully. With `BACKEND_AI_GRANULAR_REPORT_JSON=true` (or `npm run test:backend:granular:record`), the suite writes a JSON report to `reports/progress/backend-ai-granular.latest.json` for progress/audit and backprop capsule consumption.

**Diagnosing sweep failures:** When the sweep completes with failures, see `reports/orchestrator/sweep-failures.json` for step name, command, and error message per failed optional step (Backend/AI granular, Full-stack, BXR, Playwright).
