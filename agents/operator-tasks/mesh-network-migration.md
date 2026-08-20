---
task_id: mesh-network-migration
name: Private mesh migration
domain: infrastructure
stage: plan
primary_role: mesh-network
skill: gauss-mesh-network
approval: network-administrator
---

# Private Mesh Migration

## Purpose

Diagnose the current Tailscale-bound implementation and prepare a reviewable migration to a private, WireGuard-based overlay that can carry the Kali backend and bounded Turing compute traffic without weakening local/offline behavior or exposing services publicly.

## Inputs

- Current repository contracts, provider-specific scripts, security policies, and tests.
- Fresh `npm run audit:compute-sharing` output, local listener/API evidence, and the target Judith/Kali hardware profiles.
- The approved provider decision: native WireGuard hub-and-spoke, or a separately approved WireGuard-based control plane.
- Node identities and overlay addresses supplied through the host secret manager; never task-packet private keys or join tokens.
- Explicit network-administrator scope, target nodes, maintenance window, timeout, and rollback authority for any live change.

## Procedure

1. Inventory the current provider, addresses, routes, listeners, ACLs, backend health, device health, and compute-sharing state. Label each fact observed, inferred, unknown, or blocked.
2. Trace every Tailscale-specific dependency in backend contracts, device scripts, deployment helpers, security policy, configuration, and tests. Separate actual transport from mesh-ledger provenance metadata.
3. Compare the approved WireGuard-based options against acceptance gates for private binding, authenticated application probes, key rotation/revocation, local/offline fallback, memory/battery budgets, and rollback.
4. Prepare the smallest compatible transport-neutral contract and provider adapter plan. Include environment validation, migration order, compatibility behavior, and an explicit failure mode when the overlay is absent.
5. Build only repository code, tests, documentation, and safe configuration templates until live authorization exists. Do not change a remote host or network from this task.
6. Hand off an execution packet naming the exact target, bounded change, rollback, verification command, and approval owner. A later execution task must prove backend health, device health, overlay reachability, and one completed bounded Turing lease.

## Outputs

- Provider inventory and evidence table with freshness timestamps.
- Transport-neutral migration design, affected-file map, and compatibility/rollback plan.
- Reviewable code, test, documentation, or configuration-template diff, if implementation was explicitly included in scope.
- Execution packet with approval status, target list, timeout, rollback, and verification commands.

## Guardrails

Do not invent VPN cryptography or replace an unavailable overlay with a public route. Do not broaden bind addresses, firewall rules, ACLs, or trust policies. Do not store private keys, join tokens, or deployment secrets in the repository, logs, packets, or Slack. Do not claim that a configured address, Tailscale GUI, or environment variable proves a live service. Do not enable Turing work leases until the runtime audit and a completed lease provide fresh evidence.

## Verification

- `npm run audit:compute-sharing` is recorded with its exact truth state and blockers.
- `npm run develop:verify`, `npm run develop:skills:check`, `npm run develop:tasks`, and `npm run lint` pass for repository changes.
- Provider-specific references, security boundaries, local/offline paths, and rollback behavior are covered by focused tests or explicit follow-up tasks.
- No live mutation is reported unless the approved target, command, and post-change evidence are recorded.
