---
task_id: pass-planning
name: Contact pass planning
domain: ground-segment
stage: plan
primary_role: satellite-operations
skill: gauss-satellite-operations
approval: scheduling-authority
---

# Contact Pass Planning

## Purpose

Prepare a contact-window plan that accounts for visibility, station capability, spacecraft constraints, and operator workload.

## Inputs

- Satellite orbit or pass prediction with prediction epoch.
- Ground-station availability, link capability, and maintenance windows.
- Power, thermal, attitude, and payload constraints for the requested pass.

## Procedure

1. Confirm prediction freshness and the planning horizon in UTC.
2. Filter windows by elevation, link margin, station health, and spacecraft constraints.
3. Rank candidate passes and record rejected windows with reasons.
4. Assign an operator owner, readiness checkpoint, and fallback window.

## Outputs

- Selected pass plan with start/end UTC, station, objective, and owner.
- Constraint evidence, fallback pass, and approval state.

## Guardrails

Do not treat a predicted pass as a guaranteed link. Recompute or flag the plan when orbital, station, or weather inputs are stale.

## Verification

- Prediction epoch and source are recorded.
- Selected and fallback windows satisfy all hard constraints.
- A responsible operator and approval authority are named.
