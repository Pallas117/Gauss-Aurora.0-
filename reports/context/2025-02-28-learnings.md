# Learnings — 2025-02-28

After latest backprop from `2026-03-01T14-05-35Z` (see [latest-backprop.md](./latest-backprop.md)).

## 1. What from the backprop actions / readiness is most important to address next?

- **V0.2 Audit Parity:** Run `npm run audit:adherence` and fix failing gates. Current failures: Orchestrator tests (missing `surya_service_url` in `OrchestratorConfig`), Directive adherence (Python) in `ml/export/export_nowcast_onnx.py` (add gc.collect / _directive_cleanup). RBAC and some E2E steps were skipped due to missing env; address when running full release checklist.
- High readiness (96%) but large dirty worktree; isolate scope before release.

## 2. What worked well in the last cycle?

- Doc-scan plan execution: archived RADIATION_DATA_STRUCTURE, added vision refs to Scorecard / Workstream / QA_TEST_PLAN, ran context backprop successfully.
- Context backprop scaffold produced a clear capsule and next action (audit parity).

## 3. What didn’t work or should change?

- `npm run backprop:full` exited non-zero because `audit:adherence:record` had FAIL/WARN; `context:backprop` was run separately and succeeded. Consider allowing context:backprop to run even when audit has failures, or document that one can run `context:backprop` alone after viewing audit output.
- Orchestrator Rust tests need config update for new `surya_service_url` field.

## 4. What should be updated in the evaluation?

- In DEVELOPMENT_EVALUATION: note that RADIATION_DATA_STRUCTURE is archived; consider adding “Candidates for cut” or alignment updates after this doc-scan pass.
- Feed these learnings into the next improvement cycle (staff portal next implementations, QA coverage map).

---

*Reflection template: [reflection-template.md](./reflection-template.md). Full 1-hour reflection can be done in a dedicated block; this file captures the immediate post–doc-scan backprop learnings.*
