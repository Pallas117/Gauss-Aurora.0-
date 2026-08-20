---
task_id: link-recovery
name: Link recovery
domain: communications
stage: diagnose
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: communications-authority
---

# Link Recovery

## Purpose

Diagnose a communications outage and execute only bounded, reversible recovery preparation.

## Inputs

- Last-known-good contact, station health, and network path status.
- Spacecraft communications mode, beacon history, and power budget.
- Alternate station, pass, or out-of-band recovery options.

## Procedure

1. Establish the last-known-good timestamp and distinguish station, network, and spacecraft symptoms.
2. Check local/offline sources and alternate stations before declaring spacecraft loss of contact.
3. Prepare the least-invasive recovery sequence with timeout, abort, and escalation criteria.
4. Hand off any command-ready artifact for explicit authorization.

## Outputs

- Outage classification and evidence timeline.
- Bounded recovery plan, fallback contact, and escalation owner.

## Guardrails

Do not increase transmit power, change mode, or repeat commands from an unverified link diagnosis. Stop after the defined retry budget.

## Verification

- Last-known-good and source-health timestamps are present.
- Retry count and timeout budget are explicit.
- Recovery remains reversible until separately authorized.
