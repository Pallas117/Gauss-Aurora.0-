# Project Gauss — Agent Operating Contract

Project Gauss is an offline-first space-operations platform tuned for an 8 GB Apple Silicon machine. Optimize for operator clarity, bounded resource use, and verifiable changes.

## Orient before changing code

- Start with `npm run develop:status`, read `development/memory/CURRENT.md`, and validate the shared role/skill/harness map with `npm run develop:interoperability`.
- The active web entry is `src/main.tsx` → `src/App.jsx` → `src/Cybertiger.tsx`; `src/App.tsx` is a compatibility re-export, not the app shell.
- Treat `src/`, `backend/`, `gauss-orchestrator/`, `ml/`, and `supabase/` as separate ownership boundaries. Read the nearest contract and tests before crossing one.
- For satellite-operations work, select `agents/roles/satellite-operations.md`, the matching brief in `agents/operator-tasks/`, and `skills/gauss-satellite-operations/` before touching a task boundary.
- Preserve unrelated working-tree edits. Do not reset, checkout, or rewrite user changes.

## Evidence-first diagnosis and truthfulness

- Diagnose before changing or repairing: reproduce the issue, collect the raw command/API/service output, identify the boundary that failed, then choose the smallest justified action.
- Separate `observed`, `inferred`, `unknown`, and `blocked` states in updates and handoffs. If evidence conflicts, report the conflict instead of resolving it by assumption.
- Treat screenshots and GUI status as evidence of visible UI state only. Confirm daemon, CLI, API, SSH, process, and health state through the corresponding interface before relying on it.
- Never claim that a deployment, migration, fix, or remote action completed without a successful command result plus an independent verification where practical. If execution is blocked, state the exact blocker and the next required input or action.
- Prefer current source output and reproducible checks over stale reports, optimistic defaults, or inferred success.

## Blocking-first repair rule

- Always repair reproducible blocking or broken behavior within the repository during the same work unit when the fix is in scope.
- Do not normalize a failing gate as backlog, mark it resolved from discussion alone, or defer it when a repository-level repair is available.
- After each repair, rerun the failing check and an independent relevant verification; keep the issue visibly blocked until both pass.
- If the blocker depends on external approval, credentials, hardware, or remote state, record the exact boundary, owner, evidence needed, and next action in durable memory and Linear; do not claim the blocker is fixed.

## Product constraints

- Use true black (`#050505` or `#000000`) for mission backgrounds, Volt Green (`#CCFF00`) for nominal state, and Solar Red (`#FF4D00`) for critical state.
- Use Inter for headings and JetBrains Mono for operational data.
- Prefer SVG/CSS geometry. Do not add Three.js or react-three-fiber without explicit approval.
- Never leave a UI waiting on model/backend work without a skeleton, pulsing state, or cached result. Operators must understand state within 250 ms.
- Keep polling, rendering, and concurrency bounded for an 8 GB machine. Use the existing power-profile and offline paths.

## Continuous development loop

1. Choose a role in `agents/roles/` and the matching source skill in `skills/` using `config/development-interoperability.json`.
2. If the work is an operator task, validate the brief with `npm run develop:tasks` and use `agents/operator-task.schema.json` for packet exchange.
3. Record durable choices in `development/memory/DECISIONS.md`; do not bury them only in chat or generated reports.
4. If compliance or CI files change, run `npm run compliance:check -- --online --strict`; source freshness and blocking controls must be evidenced.
5. Use `npm run develop:verify` for the scaffold, then run the risk-based checks printed by `npm run develop:status`.
6. Refresh the handoff capsule with `npm run develop:brief` after a meaningful change.
7. Run `npm run develop:cleanup` before handoff. It is a dry run over an allow-list of disposable browser captures; after reviewing the list, `npm run develop:exit` applies that bounded cleanup and prints the remaining scope. Run `npm run develop:brief` separately only when you intend to retain its generated capsule. The exit command never resets Git, removes source, or deletes memory/reports.
8. Transfer work with `npm run develop:handoff -- --from <role> --to <role> --summary "..."` when a different role or agent continues it.

Read `docs/CONTINUOUS_DEVELOPMENT_SYSTEM.md` for the role map, command contracts, and skill-install procedure.

## Technical-debt rule

- Keep the active change at zero new technical debt: clean formatting, whitespace, tests, generated-artifact scope, and newly introduced TODO/FIXME/HACK markers as soon as they are found.
- After required checks pass, run `npm run debt:check`, then run the bounded cleanup flow (`npm run develop:cleanup` followed by reviewed `npm run develop:exit`) before handoff.
- For release-quality or quality-control work, run `npm run quality:check`; this serially enforces the control-plane/debt gate, TypeScript lint, frontend build, Rust formatting, Clippy with warnings denied, and Rust tests.
- “Low debt” means only pre-existing P2/P3 items with an owner, evidence, and bounded next action in `development/memory/BACKLOG.md` or the issue tracker. New P0/P1 debt, unowned debt, or an unexplained failing gate blocks handoff.
- Never hide debt by resetting Git, deleting source, or rewriting durable memory. If cleanup is unsafe or externally blocked, record the blocker and leave the repository truthfully marked `blocked` or `unknown`.
