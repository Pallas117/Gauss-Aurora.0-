# SSA Fusion (Orchestrator)

The gauss-orchestrator is the **single production path** for optical + RF measurement fusion (GAUSS-COMP-201, 202, 203): schema validation, multi-sensor track association, and uncertainty propagation with source attribution.

## Overview

- **Schema (201):** Canonical optical and RF measurement types; validation for units and covariance.
- **Association (202):** Gating, nearest-neighbor association, track lifecycle (tentative → confirmed → coasting → dropped), per-track confidence and residuals; diagnostics for explainability.
- **Uncertainty (203):** Confidence intervals and uncertainty envelope on track output; source attribution (which sensors/measurements contributed); consumable by backend for threat card rationale.

Implementation: [gauss-orchestrator/src/ssa/](gauss-orchestrator/src/ssa/) (schema, association), [gauss-orchestrator/src/ssa_api.rs](gauss-orchestrator/src/ssa_api.rs) (HTTP API).

## Schema (optical + RF)

- **Optical:** `ra_deg`, `dec_deg`, `magnitude`, `covariance` (6-element upper triangle), `observed_at`, optional `provenance` (sensor_id, calibration_metadata).
- **RF:** `range_m`, `range_rate_m_s`, `doa_deg`, `snr_db`, `covariance`, `observed_at`, optional `provenance`.
- **Validation:** Angles in valid ranges; covariance required and positive semi-definite; `observed_at` required. Invalid payloads return clear validation errors.

## Association

- **Gating:** Euclidean distance between measurement-derived position and track position; configurable threshold (default 50 km).
- **Association:** Nearest-neighbor: each measurement is assigned to the nearest track within gate, or starts a new tentative track.
- **Lifecycle:** Tentative → Confirmed after N updates; after M misses → Coasting → Dropped.
- **Output:** Tracks include position, velocity, covariance, lifecycle, confidence, last residual, and **source_attribution** (measurement refs). **Diagnostics** per update: measurement index, sensor type, track id, gate passed, residual norm, whether a new track was created.

## Uncertainty and explainability

- **Confidence interval:** 90% CI for position magnitude (m) on each track.
- **Uncertainty envelope:** 1-sigma (m) from position covariance.
- **Source attribution:** Each track carries `source_attribution: Vec<MeasurementRef>` (sensor_id, observed_at, measurement_index, sensor_type). Backend threat cards can wire rationale to these fields (orchestrator provides track-level attribution; backend maps to threat factors as needed).

## Optional HTTP API

When `ORCHESTRATOR_SSA_API_BIND` is set (e.g. `127.0.0.1:8093`):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ssa/measurements` | Body: `MeasurementBatch` (`optical`, `rf` arrays). Validates, runs association, returns `{ accepted, diagnostics, tracks, validation_error? }`. |
| GET | `/ssa/tracks` | Returns current tracks (with confidence_interval, source_attribution, lifecycle). |

Backend can GET tracks from the orchestrator or receive them via a separate feed; track JSON includes `confidence_interval`, `uncertainty_envelope_1sigma_m`, and `source_attribution` for 203 (threat outputs with source attribution and uncertainty envelope).

## Config

- `ORCHESTRATOR_SSA_API_BIND` — when set, SSA API server listens on this address (default: unset, API disabled).

## References

- Plan: SSA fusion using the orchestrator (GAUSS-COMP-201–203).
- Scorecard: [COMPETITIVE_READINESS_SCORECARD.md](COMPETITIVE_READINESS_SCORECARD.md).
- Workstream: [COMPETITIVE_WORKSTREAM_TICKETS_V1.md](COMPETITIVE_WORKSTREAM_TICKETS_V1.md).
