# Radiation and Space-Weather Applications Guide

## Purpose

Gauss should be positioned as evidence-backed exposure and decision support. It should not claim universal spacecraft failure probabilities, diagnose damage from public data, or promise a guaranteed commercial return. The paid product is the audit trail: fresh inputs, provenance, model limits, system coverage, and a clear next validation step.

## Best near-term application wedges

| Priority | Buyer and urgent problem | Product wedge | Evidence required | Why it can pay |
| --- | --- | --- | --- | --- |
| 1 | Satellite operators and ground-segment teams need rapid triage during radiation or geomagnetic events. | Fleet exposure watch, stale/conflict queue, system rollups, operator health evidence, and exportable incident record. | Public orbit/weather feeds first; authenticated spacecraft design and telemetry evidence for higher-confidence actions. | Directly reduces analyst time and supports continuity decisions. |
| 2 | Aviation, GNSS, telecom, mapping, and timing users need continuity warnings. | API/SLA for space-weather state, data freshness, regional impact, and replayable event context. | Multi-source provenance, regional validation, latency/freshness monitoring, and customer-specific thresholds. | Downtime and navigation disruption have immediate operational cost. |
| 3 | Utilities and industrial infrastructure need geomagnetic-disturbance awareness. | Magnetometer-aware dashboard, dB/dt/event timeline, asset exposure map, and tabletop exercise mode. | Local or regional magnetometers, grid topology/asset context, and validation against historical events. | High consequence makes alerting and exercises budgetable, but procurement and validation are serious. |
| 4 | Launch, lunar, and deep-space programs need radiation-environment planning. | Mission scenario replay, dose/SEE data integration, shielding assumptions, and readiness evidence pack. | Mission-specific orbit, shielding, component qualification, dosimetry, and deep-space environment models. | High contract value and strong R&D fit; sales cycles are longer. |
| 5 | Operators, regulators, and critical-infrastructure teams need training. | Public educational visualisation plus private incident-drill simulator with scored decisions and audit export. | Curated historical scenarios, instructor controls, provenance, and explicit “training only” labels. | Fastest low-friction offering; it can be sold before full predictive calibration. |
| 6 | Universities, agencies, and primes need model/data validation. | Reproducible open-data workspace with model-versus-observation metrics and dataset lineage. | Approved datasets, time alignment, uncertainty, holdout cases, and repeatable benchmark reports. | Usually grant, research, or subcontract funding rather than fast SaaS revenue. |

ESA already describes operational space-weather support across spacecraft, energy transmission, communications/navigation, aviation, pipelines, and resource exploitation, and its spacecraft-operations service includes in-orbit environment/effects monitoring, post-event analysis, forecasts, and mission-risk analysis ([ESA Space Weather Office](https://www.esa.int/Space_Safety/Space_weather/Space_Weather_Office), [ESA Spacecraft Operation Services](https://swe.ssa.esa.int/sco_services)). ESA is also studying the commercial viability of alert services for aviation, infrastructure/smart cities, and energy, which is a useful market signal—not a guarantee of demand or revenue ([SWAS feasibility study](https://business.esa.int/projects/swas)).

## What to sell first

1. **Evidence triage:** “Which systems need human review now, and why?”
2. **Freshness and conflict control:** “Which sources are stale, incomplete, or disagreeing?”
3. **Decision rehearsal:** “What would this event mean for this mission or infrastructure asset under stated assumptions?”
4. **Auditability:** “Can the customer reproduce the alert, inputs, model version, and decision record?”

Avoid leading with “failure prediction.” Until mission-specific calibration exists, use “screening,” “exposure,” “decision support,” and “operator review required.” A high exposure score is not a dose, confirmed damage, or failure probability.

## Product shape

- **Public:** beautiful SVG education view, historical playback, plain-language explanations, visible uncertainty, and no operational controls.
- **Operator:** authenticated fleet/system view, evidence ledger, stale/conflicting queues, telemetry/design evidence, role-gated recommendations, and approval records.
- **API/data:** provenance-rich JSON, freshness contracts, scenario replay, webhooks, and customer-specific thresholds.
- **Professional services:** data integration, mission baseline, tabletop exercise, validation report, and training.

The minimum paid pilot should include one customer asset group, one historical replay, one live or near-live feed, a freshness/conflict ledger, an incident export, and a weekly validation review. Do not add autonomous commands; mitigation options must remain advisory and approval-gated.

## Ground, R&D, and training uses

- **Ground operations:** prioritize satellite contacts, ground-station staffing, link margins, GNSS/timing contingency, aviation routing review, and utility tabletop response.
- **R&D:** compare model outputs with dosimeters, GOES/SEISS, magnetometers, spacecraft telemetry, and published event records; preserve holdout cases and uncertainty rather than tuning against the same data used for evaluation.
- **Training:** replay Carrington-scale, March 1989, Halloween 2003, Bastille Day 2000, September 2017, November 2003, and Gannon G5-style scenarios; score evidence handling, escalation, and recovery choices rather than rewarding a single “correct” forecast.

NASA’s deep-space radiation work demonstrates the value of combining active and passive dosimetry for Artemis and Gateway planning ([Artemis I radiation research](https://www.nasa.gov/general/artemis-i-space-radiation-research-to-help-moon-mars-explorers/), [Gateway radiation detection](https://www.nasa.gov/missions/artemis/gateway-instruments-to-improve-radiation-detection-for-artemis-astronauts/)).

## A practical 90-day commercial path

- **Days 0–30:** choose one satellite operator or ground-segment design partner; validate the evidence ledger, freshness thresholds, and incident export against one historical event and one live feed.
- **Days 31–60:** add the customer’s asset inventory, mission-specific limits, operator roles, and a tabletop exercise; measure alert latency, false escalations, and analyst time saved.
- **Days 61–90:** package the API/SLA, validation report, and training session; ask for a paid pilot or subcontract with explicit success criteria.

The strongest immediate buyer hypothesis is satellite operations/ground segment, followed by continuity-sensitive GNSS/aviation/telecom users. Utilities and deep-space programs may pay more per engagement but normally require more validation, integration, procurement, and assurance evidence.
