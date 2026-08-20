# Gauss Continuous Development Capsule

Generated: 2026-08-20T07:27:10.321Z

Branch: codex/build-interoperable-dev-system

## Working-tree scope

- No working-tree changes detected.

## Recommended verification

- npm run develop:verify
- npm run lint

## Durable memory

- development/memory/README.md
- development/memory/CURRENT.md
- development/memory/DECISIONS.md

## Satellite operator task catalog

- agents/operator-tasks/anomaly-response.md
- agents/operator-tasks/command-readiness.md
- agents/operator-tasks/link-recovery.md
- agents/operator-tasks/mesh-network-migration.md
- agents/operator-tasks/mesh-node-management.md
- agents/operator-tasks/pass-planning.md
- agents/operator-tasks/recursive-issue-resolution.md
- agents/operator-tasks/shift-handover.md
- agents/operator-tasks/telemetry-triage.md

## Active architecture map

- Web entry: `src/main.tsx` -> `src/App.jsx` -> `src/Cybertiger.tsx`
- Service boundaries: `src/`, `backend/`, `gauss-orchestrator/`, `ml/`, `supabase/`
- Handoff schema: `agents/handoff.schema.json`
- Operator task schema: `agents/operator-task.schema.json`
- Generated operator packets: `reports/context/operator-tasks/`
- Compliance manifest: `compliance/requirements.json`
- Generated compliance evidence: `reports/compliance/`

Generated capsules are handoff aids. Update `development/memory/` directly for durable facts.
