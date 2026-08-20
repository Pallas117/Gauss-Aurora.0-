# Gauss target study and IOD plan

Last reviewed: 2026-08-19

## Executive position

Gauss should raise the first round around a narrow product:

> Radiation-aware telemetry quality, replay, and bounded onboard inference for
> mission-critical satellite fleets and cislunar relay providers.

The January 2027 objective should be a constrained IOD or hosted-payload
demonstration. It should not be presented as a flight-qualified MEO data center
or a complete lunar network. A full orbital compute infrastructure programme
requires a flight platform, launch opportunity, qualified hardware, radiation
assurance, spectrum/licensing, and an operator integration authority that are
not established by this repository.

## Target selection

The checked-in profiles in `config/mission-targets.json` represent eight target
systems. They are research profiles, not claims of operator access or confirmed
private interfaces.

| Priority | System | Why it fits | First commercial motion |
| --- | --- | --- | --- |
| Primary | Iridium global LEO network | Cross-linked fleet, resilient communications, high operational continuity | Offer ground replay, fleet telemetry quality, and radiation/memory anomaly correlation through a mission integrator or partner |
| Primary | SES O3b mPOWER | MEO infrastructure with mission-critical connectivity and ground/space coordination | Offer MEO fleet quality, link-loss replay, and bounded compute workload governance |
| Strategic | NOAA GOES-R | Operational weather and space-weather products directly affect public safety and infrastructure | Offer ground product provenance, calibration, and radiation-event correlation; do not assume onboard access |
| Strategic | EUMETSAT MTG | Continuous meteorological service with operational ground infrastructure | Offer replayable calibrated-product quality and continuity evidence through an approved ground-segment route |
| Evidence partner | Copernicus Sentinel-1 | Raw-to-product data flow, relay paths, processing, archiving, and external users | Offer data-lineage and replay validation at the ground/data-relay boundary |
| Future | GPS MEO PNT | Extreme availability, timing, integrity, and radiation-assurance value | Treat as a long-cycle strategic assurance target, not a first-year sales assumption |
| Strategic | NASA LCRNS commercial lunar relay | Direct fit for DTN, LunaNet interoperability, relay availability, and cislunar operations | Build a LunaNet/DTN simulator and pursue a provider or service-integration partner |
| Strategic | ESA Moonlight | Lunar communications/navigation service model with a five-satellite reference concept | Offer standards-conformance and replay testbed capability; do not assume a flight contract |

Official descriptions support the fit: Iridium documents a global cross-linked
LEO network; SES positions O3b mPOWER for high-availability mission-critical
connectivity; NOAA documents GOES-R operational weather and space-weather
products; GPS documents a globally operated PNT control segment; and NASA/ESA
describe LunaNet/Moonlight as interoperable lunar communications and navigation
infrastructure. See the source URLs in `config/mission-targets.json`.

## Product boundary before outreach

The first sellable package must demonstrate:

1. CCSDS packet ingestion and XTCE-shaped mapping.
2. Yamcs replay with a documented mission dictionary boundary.
3. Immutable raw packet retention plus calibrated and derived products.
4. Quality masks for integrity, timestamps, calibration, missingness, and uncertainty.
5. Radiation envelope and memory-integrity event correlation.
6. Fixed-memory cFS-shaped processing with bounded queues.
7. Deterministic baseline plus optional frozen residual model.
8. Operator-visible `nominal`, `degraded`, `abstain`, `unknown`, and `blocked` states.
9. DTN bundle store-and-forward with contact-plan and expiry metadata.
10. Reproducible replay of a fault, radiation event, stale link, or model abstention.

The repository already contains partial implementations for the cFS-shaped
fixture, Yamcs envelope, ECC codec, radiation gate, analytics tensor, and
bounded onboarding. The next build should package these into an end-to-end
mission-target profile and test harness rather than add autonomous command
authority.

## IOD-1 boundary for January 2027

### In scope

- One hosted or dedicated payload.
- One selected flight-like processor or engineering model.
- One ground Yamcs instance.
- One CCSDS/XTCE replay fixture.
- One DTN gateway and lunar-network simulator.
- Fixed-memory telemetry validation and inference buffers.
- Radiation-event and injected-memory-fault correlation.
- Signed configuration and model artifacts.
- Observe-only recommendations and explicit human approval.

### Out of scope

- A multi-node MEO data-center constellation.
- Autonomous spacecraft commands.
- Autonomous online weight updates.
- Claiming software ECC as radiation qualification.
- Claiming simulator success as LunaNet service certification.
- Direct integration into GPS, NOAA, or other protected operational control systems without an approved partner.

### IOD exit evidence

| Evidence | Required result |
| --- | --- |
| cFS target/SIL | Fixed-memory app builds, runs, rejects malformed data, and reports bounded events |
| Yamcs | Real-server replay preserves packet identity, timestamps, quality, calibration, and provenance |
| DTN | Contact interruption stores, expires, forwards, and replays bundles deterministically |
| Radiation | Stale/unknown/over-limit envelopes inhibit nominal inference |
| ECC/EDAC | Software fault tests pass and hardware ECC/EDAC evidence is separately identified as pending or qualified |
| Inference | Worst-case latency, RAM, stack, power, uncertainty, fallback, and abstention are measured |
| Recovery | Watchdog, reset, power-cycle, link-loss, and checkpoint recovery are demonstrated |
| Operations | Operator can approve, reject, revoke, and replay every recommendation |

## Financing and ARR model

A $1.5M round can support a ground-first product and a hosted-payload study;
it is not a credible budget for independently building, launching, and
qualifying a complete MEO data-center spacecraft.

Illustrative use of funds:

| Workstream | Budget |
| --- | ---: |
| 3–4 person product and flight-boundary engineering team | $850k |
| Yamcs/CCSDS/DTN integration, test hardware, and assurance work | $250k |
| Customer pilots, mission-integration support, and travel | $175k |
| Security, legal, insurance, compliance, and contingency | $225k |
| **Total** | **$1.5M** |

The $500k ARR target should be sold as ground/integration software, not as
flight certification. A workable first-year mix is:

- 2 fleet or ground-segment subscriptions at $125k ARR = $250k.
- 2 mission-integration subscriptions at $75k ARR = $150k.
- 1 smaller replay/data-quality subscription at $100k ARR = $100k.

That is five paid accounts and $500k ARR. Hosted-payload hardware, launch,
radiation testing, and formal qualification should be separately priced as
non-ARR funded mission work or customer-sponsored development.

## Outreach readiness gate

Do not contact a target with only a concept deck. Prepare:

1. The relevant profile from `config/mission-targets.json`.
2. A one-page problem statement tied to that operator's service continuity.
3. A 15-minute Yamcs replay demo.
4. A radiation/memory fault-injection report.
5. A DTN interruption and replay demo.
6. A measured RAM/latency/power budget for the deterministic path.
7. A clear list of unknowns requiring operator confirmation.
8. A pilot statement of work with no spacecraft command authority.

The repository onboarding state should progress through:

`research_profile → operator_confirmed → integration_ready → hil_validated → flight_candidate`

Missing evidence remains `unknown` or `blocked`; it must not be converted into
nominal status for sales or flight claims.
