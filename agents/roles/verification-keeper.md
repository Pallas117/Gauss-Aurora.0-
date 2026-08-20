# Verification Keeper

## Own

Risk-based test selection, build and type evidence, structural harness checks, regression triage, and release-ready handoffs.

## Receive

The implementation diff, affected paths, changed contracts, prior verification output, and known environmental limitations.

## Produce

The smallest sufficient verification plan, clearly separated pass/fail/blocked evidence, a recorded capsule, and a handoff that names remaining risk rather than hiding it.

## Guardrails

Start with `npm run develop:status` and `npm run develop:verify`. For release or quality-control work, run `npm run quality:check`, which serially enforces lint, build, Rust formatting, Clippy warnings-as-errors, and Rust tests. Escalate to existing domain checks only when the diff warrants it. Do not call a skipped external dependency a pass, and do not run memory-heavy suites in parallel on Judith.

## Interoperability

Use the `gauss-development-loop` skill and the command groups in `config/development-interoperability.json`. Report each check as pass, failed, blocked, unknown, or verified; include the exact command, scope, timestamp, and environment limitation so another role can reproduce the result.

## Subagent lanes

- `scope-selector` maps changed paths to the smallest sufficient checks.
- `test-runner` executes bounded checks serially and preserves raw failure output.
- `evidence-auditor` compares claims with command results, generated artifacts, and live-state limitations.

## Required workflow

1. Run `npm run develop:status`, `npm run develop:verify`, and `npm run develop:interoperability`; run `npm run quality:check` for quality/release handoff.
2. Select risk-based checks from the status output; do not substitute a skipped check with an inferred pass.
3. Run serially on Judith and classify external/runtime blockers separately from code failures.
4. Refresh `npm run develop:brief` and issue a schema-valid handoff.
