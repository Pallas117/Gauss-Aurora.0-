# Continuous Development System

This is the repo-native control plane for repeatable human and agent collaboration. It complements the Rust model orchestrator; it does not start autonomous models, make network calls, or replace existing audits.

## Start here

```bash
npm run develop:status
npm run develop:verify
npm run develop:interoperability
npm run develop:brief
```

`develop:status` deliberately scopes to the working tree. It produces a small test plan for the change in front of you, rather than comparing a long-lived branch against `origin/main`.

## Components

| Component | Purpose |
| --- | --- |
| `AGENTS.md` | Project constraints and universal workflow for any coding agent. |
| `agents/roles/` | Bounded development and satellite-operations roles with common handoff expectations. |
| `agents/handoff.schema.json` | Portable JSON handoff contract for people, Codex, or the Rust orchestrator. |
| `agents/operator-tasks/` | Declarative satellite-operator task briefs with inputs, evidence, approvals, and outputs. |
| `agents/operator-task.schema.json` | Portable packet contract for satellite-operations work. |
| `development/memory/` | Curated durable context: index, current architecture, decisions, and review backlog. |
| `skills/` | Portable Codex skill sources for the loop, UI work, service integration, and satellite operations. |
| `config/development-interoperability.json` | Machine-readable role-to-skill map, lane registry, lifecycle/truth vocabulary, schemas, and harness command groups. |
| `config/development-interoperability.schema.json` | JSON Schema for validating the interoperability registry in other tools or CI. |
| `compliance/requirements.json` | Versioned official-source inventory and executable repository control alignment. |
| `docs/COMPLIANCE_ALIGNMENT.md` | Human-readable scope, framework mapping, and known assurance gaps. |
| `tools/development/gauss-dev.ts` | Status, brief, task catalog, handoff, and structural verification harness. |
| `tools/development/interoperability-check.ts` | Cross-checks role/skill sections, lane names, task mappings, artifacts, and package scripts. |
| `.github/workflows/ci-tests.yml` | Runs the development control-plane check as a lightweight CI job before the domain suites. |

## Role handoff

Choose the narrowest role that owns the next step:

- `mission-control` triages scope, contracts, and cross-domain decisions.
- `sovereign-ui` owns operator experience, accessibility, motion, and the 250 ms rule.
- `platform-integration` owns service boundaries, contracts, offline behavior, and migrations.
- `mesh-network` owns private overlay transport, node lifecycle, and the bounded network path for Turing shared compute; it never invents VPN crypto or performs live changes without approval.
- `network-mount` owns read-only storage plans, private filesystem transport, bounded automounts, and teardown; it never treats a mount point as proof of a healthy share.
- `memory-systems` owns evidence-backed placement across RAM, compression, swap, local storage, memory maps, unified memory, durable stores, and approved remote compute; it never treats pressure mitigation or a configured peer as available capacity without evidence.
- `verification-keeper` owns test selection, evidence, regressions, and handoff readiness.
- `satellite-operations` owns evidence-backed operator task packets and approval-gated operational outcomes.

Every handoff supplies scope, changed files, verification evidence, risks, a next owner, and any durable memory update. Create one with:

```bash
npm run develop:handoff -- \
  --from sovereign-ui \
  --to verification-keeper \
  --summary "Replaced the loading path with an SVG-safe skeleton." \
  --verification "npm run lint; npm run test:unit:ui" \
  --risks "Live backend timing still needs browser validation."
```

The command writes a timestamped JSON document under `reports/context/handoffs/`. Its shape is defined by `agents/handoff.schema.json` and can be consumed by non-Codex tooling without prompt parsing.

## Satellite operator tasks

Operator workflows are separate from software-delivery roles but use the same handoff and memory layer. Start with the task catalog:

```bash
npm run develop:tasks
npm run develop:task -- --task telemetry-triage --satellite GAUSS-1 --objective "Review the current health snapshot"
```

The briefs cover telemetry triage, anomaly response, contact-pass planning, command readiness, link recovery, shift handover, and private mesh/node management. They stop at reviewable readiness and explicit human approval; they do not authorize autonomous uplink, flight commands, or unattended network mutations.

`develop:task` writes a pending packet under `reports/context/operator-tasks/`. It is a generated context artifact, not durable memory and not an executable command.

## Memory model

Keep durable, reviewed information in the tracked files below:

- `README.md`: file contract, update rules, and operating loop.
- `CURRENT.md`: stable architecture and entry-point facts needed to begin work.
- `DECISIONS.md`: decisions that should survive a new chat, agent, or worktree.
- `BACKLOG.md`: evidence-backed improvement candidates, not a substitute for issue tracking.

`npm run develop:brief` converts that curated memory plus the current working-tree snapshot into `reports/context/continuous-development.latest.{md,json}`. Generated capsules are useful context primers; they must not silently overwrite the durable memory files.

## Skills

The source skills are valid, versioned Codex skills but stay in this repo until deliberately installed. The role-to-skill map, lane names, packet schemas, and harness commands are validated together. The `gauss-mesh-network` skill defines the observer, builder, verifier, and human-approved operator lanes for private networking. Validate them with:

```bash
npm run develop:skills:check
npm run develop:interoperability
```

Install symlinks into the current user’s Codex skills directory only when that external write is intended:

```bash
npm run develop:skills:install
```

The installer is non-destructive: it skips identical links and refuses to replace an existing skill path.

## Verification ladder

Run the smallest useful level first:

1. `npm run develop:verify` validates the control-plane structure and invokes the interoperability check.
2. `npm run develop:interoperability` validates role/skill/task mappings, shared sections, lane names, artifact paths, and harness scripts.
3. `npm run develop:status` lists the local risk-based checks for the current diff.
4. `npm run develop:tasks` validates the operator task catalog and packet references when satellite-operations work is involved.
5. `npm run compliance:check -- --online --strict` refreshes official source markers and runs the blocking alignment controls when compliance or CI files change.
6. Use existing deep tools when their affected domain is touched: `npm run test:impact`, `npm run index:system`, `npm run audit:adherence`, and the Rust/Python suites.
7. Run `npm run develop:brief` and preserve concise handoff evidence.

## Exit cleanup

The repository may contain intentional source, memory, schema, and evidence changes while a task is in progress. Do not use `git clean`, `git reset`, or a blanket deletion to make the tree appear clean. The exit harness only knows about disposable browser captures:

```bash
npm run develop:cleanup              # report candidates; no deletion
npm run develop:cleanup:apply        # remove only untracked captures in .playwright-cli/ and .playwright-mcp/
npm run develop:exit                  # apply the allow-list and print final scope
npm run develop:status               # confirm the remaining scope
```

Tracked captures are preserved, and all other paths—including `reports/`, `development/memory/`, source, tests, and configuration—are outside the allow-list. Run the dry check before every handoff; use `develop:exit` only after reviewing its candidate list. Generate a brief separately only when its report artifact is intentionally being retained.

This maintains interoperability with the existing progress checker, backprop capsule, system index, test-impact selector, and multi-agent Rust orchestrator without duplicating their responsibilities.

## Technical-debt rule

Project Gauss uses a zero-new-debt rule for every change. While implementing,
fix formatting, whitespace, warnings, failing tests, disposable artifacts, and
new TODO/FIXME/HACK markers in the touched scope as soon as they appear.

Run the executable gate before handoff:

```bash
npm run debt:check
```

It checks `git diff --check`, Rust formatting, newly introduced debt markers,
and disposable browser captures. A task may be described as low debt only when
remaining items are pre-existing P2/P3 backlog entries with an owner, evidence,
and bounded next action. New P0/P1 debt, unowned debt, or unexplained failing
checks blocks handoff. Use `npm run develop:cleanup` before reviewing disposable
captures and `npm run develop:exit` after the review; these commands never delete
source, reports, memory, or user changes.

For release-quality or scheduled quality-control work, use the serial gate:

```bash
npm run quality:check
```

This runs the control-plane/debt gate, TypeScript lint, frontend build, Rust
format checking, `cargo clippy --all-targets --all-features -- -D warnings`, and
Rust tests. Dependency/security auditing remains in the CI quality and
compliance workflows because Python and Rust audit tools are installed there in
isolated runners.
