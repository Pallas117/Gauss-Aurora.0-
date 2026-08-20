---
task_id: mesh-node-management
name: Mesh node and compute management
domain: infrastructure
stage: diagnose
primary_role: mesh-network
skill: gauss-mesh-network
approval: network-administrator
---

# Mesh Node and Compute Management

## Purpose

Onboard, observe, constrain, rotate, or revoke a private mesh node that may contribute bounded Turing compute, while preserving node identity, resource budgets, and fail-closed behavior.

## Inputs

- Node name, owner, platform, hardware profile, approved overlay address, and public identity from the host secret manager.
- Device-agent version, health heartbeat, memory/disk/load/battery evidence, backend probe result, and overlay provider status.
- Turing pool policy, radiation-work lease limits, compute-credit state, and current retry/cooldown counters.
- An explicit approval for any bootstrap, key rotation, ACL change, service restart, or node revocation.

## Procedure

1. Confirm that the node is expected, uniquely identified, and inside the approved private address policy; do not trust a self-reported address without an authenticated probe.
2. Run the bounded node-health and compute-sharing audits. Record resource headroom, freshness, packet loss, backend latency, and all blocked or unknown checks.
3. Prepare or review the provider-specific bootstrap and revocation steps, keeping credentials and private keys out of repository artifacts. Keep the node disabled for work until all gates pass.
4. After separate approval, apply only the named node change with a timeout and rollback. Verify the device listener, backend reachability, health heartbeat, and security policy after every mutation.
5. Admit the node to Turing work only when the bounded scheduler can lease and complete a radiation-screening job within memory, battery, attempt, lease, and cooldown limits.
6. On stale, unhealthy, unauthorized, or revoked evidence, stop new leases, record the reason, and hand off cleanup or recovery. Do not use an untrusted node as a remote shell or unrestricted model runner.

## Outputs

- Node inventory record with identity, provider, overlay address, evidence age, and current state.
- Admission, quarantine, rotation, or revocation decision with owner and expiry.
- Compute-sharing evidence including lease ID, resource gates, completion state, and contribution credit, or a clear blocked/unknown result.
- Handoff containing any approved live action, rollback result, and remaining risk.

## Guardrails

Never copy or print private keys, join tokens, Slack credentials, or host secrets. Never expose the backend on a public interface. Never bypass memory, battery, health, attempt, lease, or cooldown limits. Never start a lease from stale or inferred-only evidence. Node management does not grant command authority, arbitrary shell execution, or permission to change spacecraft systems.

## Verification

- The node identity and overlay path are authenticated and fresh; a GUI login or configured environment variable is insufficient.
- Backend and device health endpoints are reachable on the private path, or the state is explicitly `BLOCKED`/`UNKNOWN`.
- Resource and security policy checks pass before admission, and a completed bounded lease is present before reporting shared compute as active.
- Rotation and revocation leave no active lease or stale trust entry, or the unresolved condition is explicitly handed off.
