# Competitive Readiness Scorecard (V1)

Date: 2026-02-28
Owner: Product/Systems Architecture
Scope: Project Gauss operational stack vs benchmark capabilities (Saber Astronautics, Leanspace, Slingshot Aerospace)

**Vision / Roadmap:** This scorecard supports operator readiness and first-customer focus. See [VISION_AND_ROADMAP.md](VISION_AND_ROADMAP.md) for the broader vision (SSA today → value from debris/data → tokenisation → servicing → Ceres & Pallas) and near-term priorities.

## Method

- Scale: `0-5` per essential.
- Weighted score converted to `%`.
- Evidence based on current code only (no roadmap assumptions counted as implemented).

## Score Summary

| Competitive Essential | Weight | Score (0-5) | Weighted % | Status |
|---|---:|---:|---:|---|
| Protocol Parity (CCSDS/XTCE + standards ingest) | 30% | 4.0 | 24.0% | Green |
| Visualization Depth (glanceable cockpit utility) | 20% | 4.0 | 16.0% | Green |
| Pass Orchestration (API-first external automation) | 30% | 3.5 | 21.0% | Amber |
| SSA Automation (multi-source optical + RF fusion) | 20% | 3.5 | 14.0% | Amber |
| **Overall** | **100%** |  | **75.0%** | **Green** |

## Findings By Essential

### 1) Protocol Parity

Current state:
- **Production path:** CCSDS decode and XTCE-backed canonical mapping in the Rust orchestrator; decodes `.bin`/`.hex`/`.ccsds`, applies XTCE dictionary and APID map, posts to `POST /api/ingest/telemetry/packets`. See [CCSDS_XTCE_ORCHESTRATOR.md](CCSDS_XTCE_ORCHESTRATOR.md).
- **Decoder registry (GAUSS-COMP-001–004):** `backend/decoder-registry.ts` provides unified ingest abstraction by source/type (ccsds → orchestrator, csv → stub); protocol conformance harness in CI (`npm run test:protocol-conformance`, Rust decoder coverage gate).
- CSV ingestion for ERG/CSES tabular feeds; ML dataset builder consumes canonical JSON.

Gap vs benchmark:
- Full XTCE XML parameter/container derivation (vs. APID map JSON) remains optional.

Readiness rating:
- `4.0/5` (production path, decoder registry, conformance harness; optional full XTCE derivation)

### 2) Visualization Depth

Current state:
- ORBIT lab route still simulation driven with synthetic assets and SIM badge:
  - `/Users/josh/Documents/lightbound/Gauss/Gauss Aurora/src/components/orbit/ORBITTemplate.tsx:174`
  - `/Users/josh/Documents/lightbound/Gauss/Gauss Aurora/src/components/orbit/ORBITTemplate.tsx:235`
- Operational scene is physically parameterized by canonical feeds:
  - `/Users/josh/Documents/lightbound/Gauss/Gauss Aurora/src/components/scene/SpaceScene.tsx:286`
  - `/Users/josh/Documents/lightbound/Gauss/Gauss Aurora/src/components/scene/SpaceScene.tsx:296`

Gap vs benchmark:
- Missing full operator battle-management layer (mission timeline/tasking/playbooks/ground pass coordination panels).

Readiness rating:
- `3.0/5` (strong scientific viz, limited operator cockpit depth)

### 3) Pass Orchestration

Current state:
- Pass API (GAUSS-COMP-101–104) implemented in the Rust orchestrator when `ORCHESTRATOR_PASS_API_ENABLED=true`:
  - API-first pass planning and scheduling: `POST /passes/plan`, `GET /passes`, `GET /passes/:id`, `POST /passes/:id/schedule` ([PASS_ORCHESTRATION_API.md](PASS_ORCHESTRATION_API.md)).
  - Health with dependency status (scheduler store, antenna); optional file persistence for pass windows (`ORCHESTRATOR_PASS_STORE_PATH`); conflict response with suggested alternatives.
  - Antenna adapter interface (mock): `point`, `track_pass`, `stop`; idempotency keys and command log (`GET /antennas/commands`).
  - RBAC (viewer / operator / admin) via `X-Gauss-Role` or `X-Pass-API-Role`; audit log for mutations and 403; `X-Request-Id` on responses; `GET /audit` (admin).
- File-watcher and sensitivity routing to local/cloud inference remain in `main.rs` and `routing.rs`.

Gap vs benchmark:
- Real antenna hardware adapter and optional JWT/bearer auth are future work; operator cockpit integration (timeline, pass-impact overlays) is separate (GAUSS-COMP-301–303).

Readiness rating:
- `3.5/5` (API-first pass scheduler, persistence, RBAC, audit, antenna contract; no real adapter or full battle-management UI)

### 4) SSA Automation (Multi-source Fusion)

Current state:
- **Orchestrator SSA fusion (201–203)** implemented: [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).
  - Schema: optical + RF measurement types with validation; provenance.
  - Association: gating, nearest-neighbor, track lifecycle (tentative/confirmed/coasting/dropped), confidence, diagnostics.
  - Uncertainty: confidence_interval, uncertainty_envelope_1sigma_m, source_attribution on tracks; consumable by backend for threat card rationale.
  - Optional API: `ORCHESTRATOR_SSA_API_BIND` → POST /ssa/measurements, GET /ssa/tracks.
- Backend threat fusion (probability-fusion, probability-gate) unchanged; can consume orchestrator track feed for attribution and uncertainty.

Gap vs benchmark:
- Optional: Kalman-style covariance update from measurements; JPDA association; full UI wiring of confidence intervals and contributing factors.

Readiness rating:
- `3.5/5` (optical+RF schema, association, uncertainty and attribution in orchestrator; backend integration and UI display optional follow-up)

## Critical Blockers (Must Resolve)

1. ~~CCSDS/XTCE production path~~ Addressed: orchestrator + decoder registry + conformance harness (GAUSS-COMP-001–004); optional full XTCE XML-derived mapping.
2. ~~No pass orchestration API surface~~ Pass API implemented (101–104); optional: real antenna adapter, JWT auth.
3. ~~No optical+RF sensor fusion engine~~ Orchestrator SSA fusion (201–203); see [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).
4. ~~Operator cockpit workflow depth~~ Operator cockpit implemented (301–303): timeline, action rail, decision cards, pass overlays; see Command page and [COMPETITIVE_WORKSTREAM_TICKETS_V1.md](COMPETITIVE_WORKSTREAM_TICKETS_V1.md).

## Exit Criteria For Competitive Parity (Target >= 70%)

1. ~~Standards ingest~~ Done: orchestrator + decoder registry decode CCSDS to canonical schema; conformance in CI; see [CCSDS_XTCE_ORCHESTRATOR.md](CCSDS_XTCE_ORCHESTRATOR.md).
2. ~~Rust gateway exposes pass/antenna APIs~~ Done: [PASS_ORCHESTRATION_API.md](PASS_ORCHESTRATION_API.md).
3. ~~Fusion engine optical+RF with track confidence~~ Done: [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).
4. ~~Operational UI one-screen decision workflow~~ Done: Command page with decision cards, pass impacts (3D overlay), top actions, confidence rationale (GAUSS-COMP-301–303).
