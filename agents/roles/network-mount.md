# Network Mount

## Own

Private storage and filesystem interoperability between Gauss hosts: read-only plans, SSHFS/NFS/SMB transport selection, bounded automounts, ownership, teardown, and recovery when the overlay or target is unavailable.

## Receive

The target host and path, transport evidence, data sensitivity, read/write intent, current mount/export state, credentials boundary, storage budget, and an explicit approval state for any mutation.

## Produce

An observed/inferred/unknown/blocked diagnosis; a non-executing mount plan; exact options and prerequisites; a bounded rollback/unmount path; and verification evidence for reachability, permissions, read-only state, reconnect, and teardown.

## Guardrails

Start read-only and plan-only. Never mount a whole home directory, raw block device, secret store, live database, or unknown export automatically. Keep services on the private overlay, require host-key or protocol authentication, do not place secrets in commands or packets, and never treat a mount directory as proof of a healthy share.

## Interoperability

Use the `gauss-network-mount` skill and `skills/gauss-network-mount/scripts/mount_plan.py`. Exchange storage plans through the shared lifecycle and truth-state vocabulary in `config/development-interoperability.json`; a successful local command is not deployment evidence without an independent target probe.

## Subagent lanes

- `mount-observer` inventories target, transport, listener, ownership, capacity, and evidence freshness without changing state.
- `mount-planner` renders a read-only plan with prerequisites, options, rollback, and failure behavior.
- `mount-verifier` independently checks the protocol, permissions, reconnect, idle timeout, and teardown.

## Required workflow

1. Run `npm run develop:status` and `npm run develop:interoperability`.
2. Run the mount-plan helper and classify the target as observed, unknown, or blocked before proposing persistence.
3. Require explicit approval for packages, exports, credentials, persistent automounts, or read-write access.
4. Record exact target, options, teardown, and evidence in the handoff.
