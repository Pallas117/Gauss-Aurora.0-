---
name: nasa-space-systems-requirements
description: NASA-focused requirements engineering and verification/validation workflow for software-intensive space and control systems, specialized for orbital debris mitigation and transport/logistics automation missions. Use when Codex must create, review, decompose, allocate, trace, verify, or validate mission, system, subsystem, software, autonomy, and control requirements; prepare SRR/PDR/CDR/TRR/FRR evidence; build bidirectional traceability; close integration/test readiness gaps; or build compliance and assurance packages against NASA and aerospace standards.
---

# NASA Space Systems Requirements

## Overview

- Build requirement sets that stay testable and auditable through mission lifecycle reviews.
- Preserve strict bidirectional traceability from mission objectives to verification evidence.
- Drive integration and validation planning early enough to avoid late interface and test surprises.
- Prioritize debris-risk reduction and autonomous logistics mission assurance as first-class objectives.
- Confirm the latest revision status of every cited standard before issuing final compliance claims.

Use `references/requirements-flow.md` for the full phase-by-phase process and artifact list.
Use `references/standards-crosswalk.md` to map tasks to the right NASA and industry standards.
Use `references/debris-mitigation-profile.md` for debris-specific requirement families and evidence.
Use `references/logistics-automation-profile.md` for transport/logistics automation requirement families and evidence.

## Mission Profiles

Select one or both profiles before drafting requirements:

- `DEBRIS`: Space debris mitigation, conjunction assessment, maneuver planning, passivation, disposal, and long-term orbital sustainability.
- `LOGISTICS`: Autonomous transport operations including rendezvous/proximity operations, docking/berthing, cargo transfer, and schedule/resource optimization.

## Core Execution Pattern

### 1. Frame the mission and assurance context

- Capture mission class, criticality, autonomy level, software class, and consequence of failure.
- Identify governing authorities and review cadence (SRR, PDR, CDR, TRR, FRR, ORR as applicable).
- Establish system boundaries, external interfaces, and operational modes before writing new requirements.
- Identify debris-policy and space-traffic constraints plus ground authority for maneuver approval.
- Identify logistics concept of operations including depot nodes, transfer windows, and failure recovery paths.
- Record explicit assumptions and uncertainty items for later closure.

### 2. Build a layered requirement baseline

- Decompose from mission need to system requirements, then to subsystem and software/control requirements.
- Write each requirement in one statement with one verifiable intent.
- Enforce requirement quality checks: clear subject, measurable behavior, constraints, conditions, and units.
- Reject mixed design-plus-requirement language unless design constraint is intentional and justified.

Preferred structure:

```text
<System/Element> shall <observable behavior> within <performance bounds> under <conditions>.
```

Profile emphasis:

- `DEBRIS`: Express detection latency, conjunction risk thresholds, maneuver execution windows, post-mission disposal limits, and passivation obligations.
- `LOGISTICS`: Express transfer throughput, timing windows, docking alignment tolerances, cargo integrity constraints, and autonomous replanning bounds.

### 3. Allocate and trace requirements end to end

- Assign stable IDs with layer prefixes (for example `MIS-`, `SYS-`, `SUB-`, `SWR-`, `IF-`, `VR-`).
- Trace downward (parent to child allocation) and upward (child to governing source).
- Trace across interfaces by linking both providers and consumers to shared interface requirements.
- Link every autonomy requirement to corresponding human override, observability, and safe-state requirements.
- Add one or more planned verification methods for every leaf requirement.

Minimum trace row fields:

```text
req_id, parent_id, source, allocation_owner, interface_refs, verification_method, verification_artifact, status
```

### 4. Plan verification and validation at authoring time

- Define verification method per requirement: `T` (Test), `A` (Analysis), `I` (Inspection), `D` (Demonstration).
- Define validation strategy against mission operations and stakeholder intent, not only requirement text.
- Couple each planned method to objective success criteria and required test environment fidelity.
- Separate unit, integration, system, and mission-level verification responsibilities.
- Use high-fidelity Monte Carlo campaigns for uncertainty-heavy scenarios (traffic growth, sensor error, schedule perturbations).
- Include hardware-in-the-loop and fault-injection events for autonomy and closed-loop control behavior.

### 5. Prepare integration and readiness evidence

- Build interface control verification plans before integrated test events.
- Track closure of hazards, non-conformances, waivers, and requirement changes through CCB decisions.
- Package evidence for each review gate with requirement coverage, pass/fail disposition, and open risk.
- Flag requirement gaps as blockers when no credible verification path exists.
- For `DEBRIS`, include conjunction operations rehearsal and disposal compliance readiness evidence.
- For `LOGISTICS`, include docking contingency rehearsal, traffic conflict resolution, and cargo custody evidence.

### 6. Run requirement-change discipline

- Evaluate every change for technical impact, safety impact, cost/schedule impact, and verification impact.
- Preserve change provenance: rationale, requester, approver, affected artifacts, regression actions.
- Re-baseline traceability immediately after change approval.
- Treat orphaned requirements or orphaned tests as defects.

## Review-Gate Quality Checks

At every major review gate:

- Confirm 100% parent-child traceability coverage for in-scope requirements.
- Confirm 100% leaf-requirement verification method assignment.
- Confirm measurable acceptance criteria for all verification events.
- Confirm interface requirements are jointly owned and verified by both sides.
- Confirm residual risk disposition is explicit and board-ready.
- Confirm autonomy envelopes, override authority, and degraded-mode behavior are fully verified.
- Confirm debris and logistics operational constraints remain satisfied after late changes.

## Output Expectations

When executing this skill, deliver these artifacts unless user scope says otherwise:

- Requirement hierarchy snapshot (mission to software/control layer)
- Bidirectional traceability matrix
- Verification cross-reference matrix (methods, artifacts, status)
- Review-gate readiness checklist with open-item burn-down
- Top risks and required decisions for the next control board or design review
- Conjunction/disposal compliance package for debris mitigation scope
- Mission logistics performance and contingency assurance package for transport scope
