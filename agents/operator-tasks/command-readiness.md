---
task_id: command-readiness
name: Command readiness review
domain: command-and-control
stage: authorize
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: explicit-human-authorization
---

# Command Readiness Review

## Purpose

Validate a proposed command package and its prerequisites without transmitting or executing it.

## Inputs

- Versioned command package and target spacecraft identifier.
- Mission mode, current inhibit state, and latest health assessment.
- Contact pass, link budget, sequence timing, and rollback procedure.

## Procedure

1. Verify target, package checksum/version, sequence timing, and command compatibility.
2. Confirm fresh health telemetry, power/thermal margins, and the intended contact pass.
3. Run independent safety and authorization checks; record every result.
4. Produce a review packet marked ready, blocked, or rejected and route it to the authority.

## Outputs

- Reviewable command packet with checksums, evidence, and approval state.
- Explicit no-uplink status until a human authorization is recorded.

## Guardrails

The scaffold cannot uplink, execute, or silently retry commands. Any checksum, target, timing, or safety mismatch blocks readiness.

## Verification

- Package identity and checksum are independently verified.
- Required health and link evidence is fresh at review time.
- Approval authority, expiry, and rollback path are explicit.
