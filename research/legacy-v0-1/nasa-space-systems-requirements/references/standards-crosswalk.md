# Standards Crosswalk (NASA, Aerospace, Debris, and Logistics Automation)

Use this reference to select governing standards for requirements, software assurance, integration, and V&V activities.
Treat this as a routing aid, not an authoritative revision record.

## Mandatory Revision Check

Before final compliance claims:

- Verify the latest active revision directly from the owning authority.
- Confirm mission, center, and program-tailored addenda or waivers.
- Record exact revision identifiers and access dates in the delivered compliance matrix.

## Crosswalk

| Concern Area | Typical Standards / Guidance | Apply To |
| --- | --- | --- |
| Program and project lifecycle governance | NASA NPR 7120.5, NASA NPR 7123.1 | Lifecycle planning, technical management, review gates |
| Software engineering requirements | NASA NPR 7150.2, NASA-STD-8739.8 | Software process rigor, assurance, lifecycle artifacts |
| Software assurance and safety posture | NASA-STD-8739.9, NASA safety and risk directives | Hazard-informed software assurance and independent assessment |
| Model and simulation credibility | NASA-STD-7009 | Analysis evidence credibility and model trust decisions |
| Systems and software lifecycle process frameworks | ISO/IEC/IEEE 15288, ISO/IEC/IEEE 12207 | Process architecture, lifecycle task coverage |
| Requirements engineering discipline | ISO/IEC/IEEE 29148 | Requirement quality, structure, and management |
| Architecture description rigor | ISO/IEC/IEEE 42010 | Architecture viewpoints, rationale, and consistency |
| Airborne software assurance reference set | RTCA DO-178C (+ supplements DO-331/DO-332/DO-333) | Safety-critical software guidance, formal methods/model-based context |
| System development and safety assessment (aerospace) | SAE ARP4754A, SAE ARP4761A | System allocation, development assurance, safety assessment |
| Functional safety baseline (cross-domain) | IEC 61508 (as applicable) | SIL-style safety lifecycle framing where program requires it |
| Space debris mitigation baseline | ISO 24113, IADC Space Debris Mitigation Guidelines | Debris prevention, disposal, passivation, fragmentation risk reduction |
| Long-term sustainability governance | UN COPUOS LTS Guidelines | Operational sustainability and responsible space activities |
| Space operations message and interoperability standards | CCSDS operations and message standards (as selected by program) | Space traffic, conjunction-data exchange, cross-operator coordination |
| Docking and logistics interface governance | Program-mandated docking/berthing ICDs and interface standards | Mechanical, electrical, and command/data interoperability for transport nodes |

## Practical Selection Rules

- Start with program-mandated NASA directives first; treat them as binding unless formally waived.
- Add industry standards only where they close a rigor gap, satisfy customer constraints, or support certification strategy.
- Avoid over-constraining: include only standards that produce auditable value for the specific mission.
- Build a single compliance matrix that maps each required clause/objective to project artifacts and evidence owners.
- For debris and logistics programs, include external coordination standards only where interface contracts make them binding.

## Compliance Matrix Minimum Columns

```text
standard, clause_or_objective, required_artifact, artifact_owner, review_gate, evidence_location, status, notes
```
