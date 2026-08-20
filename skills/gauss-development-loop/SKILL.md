---
name: gauss-development-loop
description: Run Project Gauss work as a bounded, interoperable development loop. Use when Codex needs to orient in the Gauss repository, choose an agent role, preserve durable memory, select verification, create a handoff, or coordinate work across UI, backend, Rust, ML, and Supabase boundaries.
---

# Gauss Development Loop

Read `AGENTS.md`, `development/memory/CURRENT.md`, and the relevant role under `agents/roles/` before editing. Start with `npm run develop:status`; it scopes to the working tree and prints the minimal recommended checks.

## Execute work

1. Choose the narrowest role from `config/development-interoperability.json`; do not route memory, mesh, mount, or satellite work through a generic role.
2. Inspect the affected contract and existing tests before crossing a domain boundary.
3. Record durable choices in `development/memory/DECISIONS.md`. Put only evidence-backed candidates in `development/memory/BACKLOG.md`.
4. Run `npm run develop:verify` and then the relevant checks from `develop:status`; for release-quality work run `npm run quality:check` serially.
5. Run `npm run develop:brief` after meaningful work. Hand off with `npm run develop:handoff -- --from <role> --to <role> --summary "..."` when ownership changes.

Do not treat generated reports as permanent memory. Preserve unrelated local edits and keep external actions approval-gated.

## Interoperability

Use the role-to-skill map and shared truth/lifecycle vocabulary in `config/development-interoperability.json`. Cross-boundary work exchanges `agents/operator-task.schema.json` packets or `agents/handoff.schema.json` handoffs; do not invent a second task or status format.

## Verification

Run `npm run develop:verify`, `npm run develop:interoperability`, and the affected checks selected by `npm run develop:status`. For quality-control/release work, `npm run quality:check` is the required serial gate and includes Clippy with warnings denied. Record exact commands and classify external/runtime limitations as blocked or unknown.
