# Partner boundaries and reference deployment

## Decision

Gauss is the interoperable mission-data assurance and protection layer. It
does not replace a partner's sensor, mission-control system, optical network,
operating system, cryptography, or trust root. Partner capabilities are
consumed through versioned adapters and validated as external evidence gates.

The public capability references below are discovery sources, not flight-
qualification or contractual evidence. The manifest records this explicitly as
`public_capability_claim` until each partner confirms the integration surface.

## What Gauss should leverage

| Partner | Partner-owned capability to leverage | Gauss product wrapper | Explicit non-compete boundary |
| --- | --- | --- | --- |
| [xOrbita](https://xorbita.com/data) | SSA sensing, object detection/characterisation, orbital-state and risk data | Licensed-event ingestion, provenance, quality scoring, telemetry/radiation/memory correlation, fleet evidence | No competing sensor, catalogue, or raw-data redistribution; Gauss scores and correlates partner inputs rather than claiming to produce them |
| [JAOPS](https://www.jaops.com/) | Yamcs Gateway/mission-control tooling, simulations, operator training, mission planning and supervised operations | Yamcs processor/data-link integration, replayable quality and radiation evidence, bounded inference, operator-visible advisory events | No MCC replacement, telecommand path, training/OaaS resale, or autonomous command authority |
| [Transcelestial](https://transcelestial.space/) | Optical space/ground terminals, inter-satellite links, high-rate downlink, link monitoring and scheduling | DTN/store-and-forward policy, link-quality provenance, radiation-aware workload selection, data-product and compute-lease coordination | No terminal, PAT, beam-control, or network-scheduling product; Gauss submits data intents only where separately authorised |
| [Pan Galactic Corporation](https://www.pangalactic.io/) | GalacticOS, secure boot, quantum-safe cryptography/container security, and secure ledger claims | Mission schemas, provenance, model/artifact governance, radiation-aware compute leases and abstention policy on the partner trust boundary | No competing OS, crypto library, trust root, ledger, or independent PQC/certification claim |

“Pangalactic” is ambiguous in public search results. This document assumes
the intended partner is Pan Galactic Corporation at `pangalactic.io`; confirm
the legal entity, products, and URLs before signing or publishing a joint
claim.

## Reference deployment

```text
xOrbita SSA events ─┐
                    ├─> JAOPS Yamcs / simulator / operator workflow
spacecraft TM ──────┤                  │
                    │                  ▼
Transcelestial link ─> Gauss Fleet Integration / Bridge Node
telemetry            │   quality • provenance • radiation • DTN • leases
                    │                  │
                    └─> Pan Galactic signed host/trust boundary
                                       │
                                       └─> advisory result / approved data intent
```

The safe first deployment is ground-only or simulator-backed. A flight-
candidate adapter is a later evidence package, not a claim that the partner
hardware, cFS build, radiation environment, or mission operations are
qualified. The Gauss safety contract remains:

- no command authority;
- no online weight updates;
- deterministic baseline on invalid, stale, uncertain, radiation-inhibited,
  or resource-exhausted input;
- human approval before an operational recommendation becomes an action;
- immutable raw and calibrated lineage with replay identifiers.

## Integration contracts to request

Before implementation is marked partner-confirmed, obtain a versioned answer
for each item:

1. xOrbita: event/track schema, orbit-state covariance, confidence semantics,
   latency/freshness, licensing, redistribution, and incident support.
2. JAOPS: Yamcs Gateway version, plugin/data-link API, packet quarantine and
   replay semantics, alarm routing, operator approval workflow, and support
   ownership.
3. Transcelestial: terminal and link-health telemetry/API, scheduling status,
   DTN or transfer-intent boundary, authority separation, security profile,
   and contact-gap behaviour.
4. Pan Galactic: exact GalacticOS/QSL/SecCon/QB versions, deployment model,
   secure-boot and key-management evidence, external attestations, ledger
   export API, and incident-response boundary.

Each adapter must declare schema version, owner, freshness, failure mode,
license/redistribution constraint, test fixture, and rollback behaviour. Deep
forks are prohibited unless a partner jointly owns the fork and its update
policy.

## Commercial packaging

- **Fleet Integration**: ground-first adapter package for mission-data and
  fleet-integration buyers. Partner systems remain the operational systems of
  record.
- **Flight Candidate Adapter**: cFS-shaped fixed-memory application and
  evidence pack, validated through a partner simulator/HIL path before any
  flight review.
- **Federated Bridge Node**: bounded DTN, provenance, data-protection, and
  compute-lease node deployable on approved partner infrastructure.

The machine-readable ownership and safety contract is
`config/product-packages.json`, validated by
`npm run audit:product-packages`. The product manifest deliberately keeps
partner confirmation separate from public web claims.

## Contract and procurement guardrails

Partner agreements should define data ownership and derived-data rights,
license/redistribution limits, IP and adapter ownership, support/SLA boundary,
security and incident notification, export-control responsibility, test-data
use, customer-facing claims, and the point at which a recommendation is
considered a command. No joint marketing language should imply flight
certification, radiation tolerance, autonomous command, or PQC compliance
until the relevant external evidence exists.
