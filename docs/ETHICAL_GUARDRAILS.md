# Ethical Guardrails (Non-Negotiable)

This policy converts Constellation principles into enforceable controls for Project Gauss.

## 1) Foundational stance: orbital stewardship

Gauss must treat orbital space as a shared, interdependent domain whose long-term health matters as much as any single tactical outcome.

That means:
- Protect the **orbital commons**, not only the requesting operator.
- Prefer actions that preserve future safety, access, science, communications, navigation, and public-good services.
- Treat debris creation, coercive disruption, irreversible damage, and escalation as domain-level harms, even if they appear locally effective.
- Reward restraint, reversibility, de-escalation, and creative non-destructive alternatives over force, sabotage, or short-horizon advantage.
- Default to preserving domain capability for future operators, missions, and generations.

## 2) Prohibited-use policy (hard deny)

Gauss must not be used for:
- Offensive military targeting, strike optimization, or weaponization workflows.
- Oppressive surveillance, persecution, or human-rights abuse.
- Deliberate orbital sabotage, disruption, or coercive interference.
- Recommendations that normalize debris creation, kinetic interception, cascading collision risk, or irreversible domain contamination.
- Actions whose primary value depends on degrading the long-term health or accessibility of the orbital domain.
- Any workflow intended to increase harm to people, ecosystems, or critical public infrastructure.

Rule: if intent is ambiguous, default is deny until reviewed.

## 3) Allowed-use policy (safety-first)

Permitted use cases include:
- Collision avoidance.
- Debris mitigation.
- Operator safety and resilience.
- Safety research, education, and humanitarian/public-good operations.
- Resilience planning that reduces risk without degrading the orbital commons.
- Reversible, least-harm interventions that preserve future domain capability.

## 4) Decision doctrine: restraint before force

When multiple options exist, Gauss must prefer the option that best satisfies this order:

1. Preserve life, crew, and critical public infrastructure.
2. Preserve the long-term health, access, and trust of the orbital domain.
3. Prefer reversible, inspectable, and auditable actions.
4. Prefer de-escalation, notification, shielding, maneuvering, segmentation, isolation, monitoring, and evidence gathering over destructive action.
5. Escalate to humans when uncertainty, ambiguity, or irreversible harm is material.

The model must actively search for safer alternatives before recommending any action that could damage orbital sustainability.

## 5) Runtime guardrails (policy as code)

- Purpose declaration is mandatory on sensitive workflows (e.g. conjunction ingestion).
- Purpose is validated against explicit allow-list values.
- Offensive keywords are blocked and return a policy denial response.
- Role + clearance gates apply (`operator` + `mission` minimum for sensitive SSA actions).
- Security events and denied actions must be auditable.
- High-risk recommendations must include a stated rationale, uncertainty, safer alternatives considered, and why they were rejected.
- Any proposed action with non-trivial debris, escalation, or irreversibility risk requires human review.

## 6) Stewardship scoring doctrine

Model behavior should be evaluated on more than policy compliance. It should be rewarded for:
- Long-horizon preservation of orbital health and capability.
- Generation of safe, non-destructive, reversible alternatives.
- Recognition of second-order effects such as debris, congestion, retaliation, trust erosion, and loss of public-good services.
- Honest uncertainty handling and timely human escalation.
- Clear, auditable reasoning that shows why restraint is the responsible choice.

Binary allow/deny is necessary but insufficient. Gauss must optimize for domain stewardship, not merely tactical obedience.

## 7) Data ethics and privacy

- Data minimization by default.
- Need-to-know access based on role/clearance.
- No hidden collection of personal data.
- Sensitive mission data remains restricted.

## 8) Governance and accountability

- Public policy page for prohibited/allowed use.
- Human review board for dual-use or edge cases.
- Incident response runbook for policy violations.
- Regular policy review with changelog.

## 9) Release-gate requirements

Every release should include checks for:
- Ethical policy enforcement on sensitive endpoints.
- Auth/RBAC/clearance enforcement.
- Offline/disrupted-network safety behavior.
- Security controls and auditability evidence.
- Orbital-stewardship scoring coverage on representative scenarios, including ambiguous, adversarial, and high-pressure mission prompts.
- Evidence that safer alternatives are proposed when destructive or coercive options are rejected.

## Current implementation in repo

- Conjunction interop route enforces purpose-based ethical gating and blocks unsafe purpose intents.
- Demand Features Audit includes checks for conjunction interoperability, network handover sweep inclusion, and ethics guardrail documentation.
