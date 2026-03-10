# Competitive Workstream Tickets (V1)

Date: 2026-02-22
Status convention: `OPEN`, `IN_PROGRESS`, `BLOCKED`, `DONE`
Priority: `P0` (critical), `P1` (high), `P2` (medium)

**Vision / Roadmap:** These tickets advance the ultimate ops tool and operator progression (MEO/GEO → ISAM → deep space). See [VISION_AND_ROADMAP.md](VISION_AND_ROADMAP.md) for the full roadmap and 2030 in-space narrative.

**CCSDS/XTCE production path:** The Rust orchestrator is the single production path for CCSDS decode and XTCE-backed canonical mapping. See [CCSDS_XTCE_ORCHESTRATOR.md](CCSDS_XTCE_ORCHESTRATOR.md). Protocol-parity tickets (001–004) extend or harden this path.

## Ticket Board

| Ticket | Workstream | Priority | Status | Effort | Dependencies |
|---|---|---|---|---|---|
| GAUSS-COMP-001 | Protocol Parity: Telemetry ingest abstraction | P0 | DONE | 3d | None |
| GAUSS-COMP-002 | Protocol Parity: CCSDS packet decoder | P0 | DONE | 5d | GAUSS-COMP-001 |
| GAUSS-COMP-003 | Protocol Parity: XTCE dictionary loader + mapper | P0 | DONE | 5d | GAUSS-COMP-001 |
| GAUSS-COMP-004 | Protocol Conformance and regression test harness | P0 | DONE | 3d | 002, 003 |
| GAUSS-COMP-101 | Pass API: Rust HTTP service scaffold | P0 | DONE | 3d | None |
| GAUSS-COMP-102 | Pass scheduler domain model + persistence | P0 | DONE | 5d | 101 |
| GAUSS-COMP-103 | Antenna pointing command adapter interface | P0 | DONE | 4d | 101 |
| GAUSS-COMP-104 | Pass orchestration RBAC + audit trail | P0 | DONE | 3d | 101, 102, 103 |
| GAUSS-COMP-201 | SSA Fusion: sensor measurement schema (optical + RF) | P0 | DONE | 4d | None |
| GAUSS-COMP-202 | SSA Fusion: multi-sensor track association engine | P0 | DONE | 6d | 201 |
| GAUSS-COMP-203 | SSA Fusion: uncertainty propagation + explainability | P1 | DONE | 4d | 202 |
| GAUSS-COMP-301 | Operator cockpit: timeline + action rail | P1 | DONE | 4d | 101, 102 |
| GAUSS-COMP-302 | Operator cockpit: pass-impact overlays in 3D | P1 | DONE | 4d | 201, 301 |
| GAUSS-COMP-303 | Operator cockpit: one-screen decision cards | P1 | DONE | 3d | 203 |

---

## GAUSS-COMP-001 - Protocol Parity Ingest Abstraction

Objective:
- Introduce a unified telemetry ingest interface separating transport decode from canonical mapping.

Scope:
- Add `backend/ingest/decoder-registry.ts`.
- Add decoder contract (`decode(raw) -> normalized packets`).
- Keep current CSV parsers as adapter implementation.

Acceptance criteria:
1. Decoder registry selects implementation by source/type metadata.
2. Existing CSV path continues to function unchanged.
3. Unit tests cover fallback behavior and malformed input isolation.

**Implementation:** `backend/decoder-registry.ts` — registry by source/type (ccsds → orchestrator, csv → stub); `getDecoder(source, type)`, `decode(raw, options)`; unit tests in `decoder-registry.test.ts`.

---

## GAUSS-COMP-002 - CCSDS Packet Decoder

Objective:
- Decode CCSDS packets into intermediate telemetry structures.

Scope:
- Add packet primary header parser.
- Support variable APID mapping configuration.
- Add CRC/length validation flags.

Acceptance criteria:
1. Decoder accepts binary/hex packet test vectors.
2. Invalid packet length/checksum is flagged, not silently dropped.
3. Output packets include timestamp, APID, payload bytes, and quality flags.

**Implementation:** Rust orchestrator (`gauss-orchestrator`): CCSDS primary header, APID map, CRC/length validation. Node registry (001) delegates via `ORCHESTRATOR_DECODE_API_BIND`.

---

## GAUSS-COMP-003 - XTCE Dictionary Loader + Mapper

Objective:
- Parse XTCE dictionaries and map decoded packet payloads into canonical fields.

Scope:
- XTCE XML ingest service.
- Parameter lookup and extraction rules.
- Mapping layer to canonical Gauss schema.

Acceptance criteria:
1. XTCE load succeeds for baseline dictionary in tests.
2. At least one APID payload is mapped to canonical fields (`speed`, `density`, `Bz`, etc.).
3. Missing parameters produce explicit quality flags and uncertainty annotations.

**Implementation:** Rust orchestrator: `config/xtce/baseline.xtce.xml`, `config/xtce/apid-map.json`; mapping in `gauss-orchestrator/src/telemetry/`. Node registry (001) delegates decode to orchestrator.

---

## GAUSS-COMP-004 - Protocol Conformance Harness

Objective:
- Prove parser correctness and regression stability.

Scope:
- Add test vectors (good/bad packets, boundary cases).
- Snapshot tests for canonical output shape.
- CI gate for parser regressions.

Acceptance criteria:
1. CI fails if canonical mapping changes without approved fixture update.
2. Coverage for packet validation paths exceeds 90% for decoder modules.

**Implementation:** The conformance harness consists of (1) Rust orchestrator tests (`gauss-orchestrator/tests/ccsds_decoder_tests.rs`, `decode_api_tests.rs`, `xtce_*.rs`) for decoder and decode API behaviour; (2) the Node script `backend/scripts/protocol-conformance.ts`, run via `npm run test:protocol-conformance`, which sends `gauss-orchestrator/tests/fixtures/ccsds_valid.bin` to the orchestrator decode API (when `ORCHESTRATOR_DECODE_API_BIND` is set) and asserts decoded packet shape (timestamp, apid). When the bind is unset, the script exits successfully (skip). CI (`.github/workflows/ci-tests.yml`): backend-node-tests run `npm run test:protocol-conformance` (skip when bind unset); rust-orchestrator-tests enforce decoder coverage >= 90%.

---

## GAUSS-COMP-101 - Pass API Rust Service Scaffold

Objective:
- Evolve Rust orchestrator into API-first pass orchestration service.

Scope:
- Add HTTP server crate in `/Users/josh/Documents/lightbound/Gauss/Gauss Aurora/gauss-orchestrator`.
- Add endpoints:
  - `POST /passes/plan`
  - `GET /passes/:id`
  - `POST /passes/:id/schedule`

Acceptance criteria:
1. Endpoints return typed JSON contracts.
2. Health endpoint includes dependency status.
3. Existing file-routing functionality remains operational behind feature flag.

---

## GAUSS-COMP-102 - Pass Scheduler Domain Model

Objective:
- Implement pass windows, constraints, and scheduling decisions.

Scope:
- Pass entity model (`aos`, `los`, station, target, priority).
- Conflict resolution policy and deterministic tie-breaking.
- Persistence adapter (initially Supabase table or local store).

Acceptance criteria:
1. Scheduler rejects overlapping reservations per antenna.
2. Deterministic outcomes for identical input set.
3. API exposes conflict reasons and suggested alternatives.

---

## GAUSS-COMP-103 - Antenna Pointing Adapter Interface

Objective:
- Enable external software/hardware integration for pointing automation.

Scope:
- Adapter contract:
  - `slew_to(az, el, at)`
  - `track(tle_or_ephemeris)`
  - `stop()`
- Mock adapter for local testing.

Acceptance criteria:
1. Pass execution emits adapter command sequence logs.
2. Retry + timeout behavior is configurable and tested.
3. Command idempotency keys prevent duplicate actuation.

---

## GAUSS-COMP-104 - Pass Orchestration RBAC + Audit

Objective:
- Enforce safe operation controls for commanding actions.

Scope:
- RBAC enforcement:
  - viewer: read-only
  - operator: plan/schedule
  - admin: adapter command overrides
- Signed audit log for schedule and pointing operations.

Acceptance criteria:
1. Unauthorized command attempts return 403 and are audited.
2. All schedule and command mutations include actor id + timestamp + request id.
3. RBAC smoke includes pass API matrix.

---

## GAUSS-COMP-201 - SSA Sensor Schema (Optical + RF)

Implementation: [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).

Objective:
- Define canonical measurement schema for heterogeneous SSA inputs.

Scope:
- Optical observation fields (angles, magnitude, covariance).
- RF observation fields (range/range-rate/DOA/SNR, covariance).
- Sensor provenance and calibration metadata.

Acceptance criteria:
1. Ingest accepts both optical and RF test payloads.
2. Schema validation catches unit mismatches and missing covariance.

---

## GAUSS-COMP-202 - Multi-sensor Track Association

Implementation: [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).

Objective:
- Associate measurements into unified tracks with confidence.

Scope:
- Gating + nearest-neighbor/JPDA-style association baseline.
- Track lifecycle (`tentative`, `confirmed`, `coasting`, `dropped`).
- Per-track confidence and residual metrics.

Acceptance criteria:
1. Synthetic mixed-sensor scenario produces consistent track IDs over time.
2. Track confidence degrades predictably on sensor dropout.
3. Association decisions are explainable in diagnostics output.

---

## GAUSS-COMP-203 - Uncertainty Propagation + Explainability

Implementation: [SSA_FUSION_ORCHESTRATOR.md](SSA_FUSION_ORCHESTRATOR.md).

Objective:
- Surface uncertainty and rationale in operator-facing outputs.

Scope:
- Confidence interval propagation from sensor-level covariance.
- Threat card rationale fields wired to measurement evidence.

Acceptance criteria:
1. Threat outputs include source attribution and uncertainty envelope.
2. UI displays confidence intervals and top contributing factors for each action.

---

## GAUSS-COMP-301 - Operator Cockpit Timeline + Action Rail

Objective:
- Upgrade from visualization to operator decision workflow.

Scope:
- Add timeline panel for events, pass windows, alerts, recommended actions.
- Add quick action rail with role-aware buttons.

Acceptance criteria:
1. Viewer/operator/admin each see correct action affordances.
2. Timeline updates from canonical snapshot endpoint without route switching.

**Implementation:** `src/components/cockpit/ActionRail.tsx` (role-aware Refresh, Dashboard, Run nowcast, Team, Chronos); `src/components/cockpit/OperatorTimeline.tsx` (passes, gate, storm tier, recommended action, source health). Command page (`src/pages/CommandPage.tsx`) uses `useMissionSnapshot` / `useOpsCommandSnapshot` / `useMissionCoreSnapshot`; timeline and rail stay on `/command` with data from snapshot APIs (no route switch).

---

## GAUSS-COMP-302 - Pass Impact Overlay in 3D Scene

Objective:
- Connect pass schedule and SSA risk context to scene.

Scope:
- Render pass arcs, antenna footprints, and risk overlays.
- Display active track confidence and uncertainty volumes.

Acceptance criteria:
1. Overlay toggles are deterministic and explain disabled state.
2. Scene remains usable under WebGL fallback with 2D equivalent indicators.

**Implementation:** `src/components/scene/PassArcsOverlay.tsx` renders pass arcs in 3D; `SpaceScene` accepts `passWindows` and `showPassOverlays`. Heliophysics dashboard sidebar has "Pass arcs overlay" checkbox—disabled when no pass data, with aria-describedby text ("No pass data" vs "Show pass windows in 3D"). `SceneErrorBoundary` in `SpaceScene.tsx` provides fallback message when WebGL fails; data panels remain available.

---

## GAUSS-COMP-303 - One-screen Decision Cards

Objective:
- Present concise operator action guidance.

Scope:
- Top action card, top-3 threats, confidence intervals, factor rationale.
- Explicit gate state (`TRIGGER_LLM` vs `LOG_AND_SLEEP`) and recommended next action.

Acceptance criteria:
1. Operator can determine next action in <10 seconds from a single screen.
2. Card content aligns with backend threat summary contract.

**Implementation:** `src/components/cockpit/OperatorDecisionCards.tsx`: top action card, top-3 threats with confidence intervals and factor rationale, gate badge (`TRIGGER_LLM` / `LOG_AND_SLEEP`), recommended next step. Consumes `ThreatSummaryResponse` from threat-summary API; shown on Command page above telemetry and source health.

---

## Milestone Mapping

| Milestone | Ticket completion requirement |
|---|---|
| V0.6 Competitive Foundation | 001-004, 101 |
| V0.7 Pass Automation Alpha | 102-104 |
| V0.8 SSA Fusion Alpha | 201-203 |
| V0.9 Operator Cockpit Beta | 301-303 |
| V1.0 Competitive Readiness | All tickets done + end-to-end validation pass |

## Recommended Execution Order

1. `GAUSS-COMP-001` -> `002` + `003` -> `004`
2. `GAUSS-COMP-101` -> `102` + `103` -> `104`
3. `GAUSS-COMP-201` -> `202` -> `203`
4. `GAUSS-COMP-301` -> `302` -> `303`
