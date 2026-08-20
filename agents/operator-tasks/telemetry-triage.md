---
task_id: telemetry-triage
name: Telemetry triage
domain: spacecraft-health
stage: observe
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: operator-review
---

# Telemetry Triage

## Purpose

Turn a bounded telemetry snapshot and alarm stream into a timestamped health classification that an operator can verify at a glance.

## Inputs

- Spacecraft identifier and mission mode.
- Latest telemetry snapshot, alarm stream, and source timestamps.
- Freshness thresholds for power, thermal, attitude, payload, and communications values.

## Procedure

1. Confirm source health, clock alignment, and freshness before interpreting values.
2. Compare each subsystem against its configured nominal and critical limits.
3. Classify the spacecraft as nominal, degraded, critical, or unknown and record the evidence.
4. Escalate critical or conflicting signals; otherwise state the next observation window.

## Outputs

- Health classification with UTC timestamp and confidence.
- Evidence list, stale fields, and escalation or clearance decision.

## Guardrails

Do not interpolate missing values into a nominal decision. A stale or conflicting source is degraded or unknown until resolved.

## Verification

- Source timestamps and freshness limits are present.
- Every critical classification cites at least one measured signal.
- The record names an owner and an expiry for the next review.
