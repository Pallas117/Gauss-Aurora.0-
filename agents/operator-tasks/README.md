# Satellite Operator Task Catalog

Operator tasks are bounded, declarative work packets. They require explicit scope, approval, evidence, and verification before any external action.

## Task Contract

Each task brief uses the shared `agents/operator-task.schema.json` packet contract. Its metadata names the task, domain, lifecycle stage, owning role, source skill, and required approval boundary.

## Catalog

- `anomaly-response.md` — contain and escalate suspected spacecraft anomalies.
- `command-readiness.md` — verify evidence and approval before a command-ready artifact.
- `link-recovery.md` — diagnose and plan bounded communications-link recovery.
- `mesh-network-migration.md` — plan approval-gated private-mesh migration work.
- `mesh-node-management.md` — manage enrolled mesh nodes with fresh health evidence.
- `pass-planning.md` — prepare a bounded contact/pass plan.
- `recursive-issue-resolution.md` — decompose and verify cross-domain repository issues.
- `shift-handover.md` — transfer operational context with explicit unknowns and risks.
- `telemetry-triage.md` — classify telemetry evidence before escalation.

## Lifecycle

Briefs move through `observe`, `diagnose`, `plan`, `authorize`, `execute`, and `handoff`. A task may produce a plan or evidence packet without authorizing a spacecraft command; execution remains approval-gated and must stop on stale, conflicting, or unknown evidence.
