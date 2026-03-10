# Spacecraft Operations Procedures (Gauss RAG)

This document summarizes spacecraft operations norms used by the Gauss co-pilot for mission assessment and recommendations.

## CCSDS and telemetry standards

- Telemetry parsers accommodate **CCSDS** (Consultative Committee for Space Data Systems) headers. Packet structure and APID mapping follow project XTCE/orchestrator definitions.
- Pass management: contacts are scheduled and tracked; telemetry drop directories (e.g. `ORCHESTRATOR_TELEMETRY_DIR`) receive CSV or packet files for processing.
- Safe modes: when anomalies exceed thresholds, recommendations escalate from NOMINAL → MONITOR → INITIATE SHIELDING (or equivalent). Operations procedures prefer deterministic, auditable responses.

## Mission assessment vocabulary

- **NOMINAL**: No actionable threat; continue routine operations.
- **MONITOR**: Elevated risk or uncertainty; increase watch, no immediate action.
- **INITIATE SHIELDING** (or equivalent): High confidence threat; execute protective procedures (e.g. LEO shielding protocol, asset reorientation, or safe mode) per mission playbooks.

## Recommendation format

Assessments must be brief (2–4 sentences), state a clear recommendation (NOMINAL / MONITOR / INITIATE SHIELDING), and provide a one-line rationale grounded in the telemetry or physics context provided.
