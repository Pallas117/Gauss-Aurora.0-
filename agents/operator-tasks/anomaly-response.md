---
task_id: anomaly-response
name: Anomaly response
domain: fault-management
stage: diagnose
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: flight-director-or-designate
---

# Anomaly Response

## Purpose

Convert a confirmed or suspected anomaly into a contained, reviewable response plan without hiding uncertainty.

## Inputs

- Telemetry triage record and alarm timeline.
- Recent commands, mode transitions, and source provenance.
- Fault tree, safe-mode criteria, and current contact opportunity.

## Procedure

1. Establish the event timeline in UTC and separate measured facts from hypotheses.
2. Check whether the anomaly is isolated, correlated, stale-data-driven, or safety-critical.
3. Select the least-invasive containment step and define an abort or rollback condition.
4. Request the named approval before any command-ready artifact is prepared.

## Outputs

- Anomaly assessment with confidence and affected subsystems.
- Containment and escalation plan with approval status and expiry.

## Guardrails

Never recommend a mode change solely from a single unverified alarm. Preserve the last-known-good state and stop on contradictory evidence.

## Verification

- Timeline entries have source and UTC timestamps.
- Hypotheses are labeled separately from observations.
- Approval, abort condition, and escalation owner are explicit.
