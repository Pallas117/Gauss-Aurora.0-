---
task_id: shift-handover
name: Shift handover
domain: operations-continuity
stage: handoff
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: receiving-operator-acknowledgement
---

# Shift Handover

## Purpose

Transfer operational context so the receiving operator can act safely without reconstructing the prior shift from chat or logs.

## Inputs

- Open task packets, active anomalies, and current spacecraft modes.
- Upcoming passes, deadlines, approvals, and expiring assumptions.
- Links to evidence, decisions, and unresolved risks.

## Procedure

1. Summarize state by spacecraft and classify each item as nominal, degraded, critical, or unknown.
2. List actions completed, actions pending, blocked items, and explicit next owners.
3. Mark evidence timestamps, approval expiry, and the next review checkpoint.
4. Obtain receiving-operator acknowledgement and preserve the handoff artifact.

## Outputs

- A concise UTC handover record with owners, deadlines, evidence, and risks.
- Acknowledgement status and follow-up memory update.

## Guardrails

Never close an item only because the shift ended. Unknown or unacknowledged state remains open and escalated.

## Verification

- Every open task has an owner and next action.
- Expiring approvals and stale evidence are called out.
- Receiving acknowledgement is recorded or the handover is escalated.
