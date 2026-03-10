# Data Analysis Models

This document lists the data analysis models used in Project Gauss and how they relate to **data crunching** and **waste deletion** (retention, caps, and cleanup).

## Data analysis models (audit)

| Model / component | Input | Output | Location |
|-------------------|--------|--------|----------|
| **Probability / engine (threat)** | Telemetry bundle (orbital, network), external data (space_track, solar, debris) | Threat assessments (collision, solar flare, cyber, debris); fused threats with composite score and recommended action | Backend: `backend/engine.py` (SpaceProbabilityEngine), `backend/ml-client/probability-fusion.ts` (ProbabilityFusionEngine) |
| **Physics / reconstruction** | Time-series DataFrame (e.g. particle flux); optional timestamp column | Reconstructed series, corrupted mask, integrity score, anomaly count | Backend: `backend/gauss_physics_imputer.py` (GaussPhysicsImputer) |
| **Multi-agent data analysis** | Task input (e.g. telemetry or problem statement) | Consensus synthesis from DeepSeek, GPT-4, Gemini | Gauss orchestrator: `gauss-orchestrator/src/multi_agent.rs` (`TaskType::DataAnalysis`) |
| **ML client (nowcast)** | Canonical point sequence | Nowcast inference result (or fallback) | Backend: `backend/ml-client/client.ts` (inferNowcast) |
| **Probability gate** | Canonical sequence, config | Urgency (urgent / non-urgent); gates whether heavy LLM is invoked | Backend: `backend/ml-client/probability-gate.ts` (evaluateInferenceUrgency) |

All of the above consume **bounded inputs** (feeds with caps or fixed windows). Downstream retention and cleanup keep storage and memory bounded; see the next section.

---

## Retention and data reduction (“crunch and delete waste”)

### Backend in-memory caps

| Store | Cap (default) | Env override | Reference |
|-------|----------------|--------------|-----------|
| Canonical feed | 20,000 points | `CANONICAL_FEED_MAX` | `backend/state.ts` |
| MMS feed | 5,000 points | `MMS_FEED_MAX` | `backend/state.ts` |
| Decoder samples | 1,000 samples | (fixed) | `backend/decoder-status.ts` |
| Feedback events | 500 events | (fixed) | `backend/routes/feedback.ts` |
| Cybertiger events | 5,000 (default) | `CYBERTIGER_MAX_EVENTS` | `backend/cybertiger/daemon.ts` |
| Turing pool devices | no cap by default | `TURING_POOL_MAX_DEVICES` | `backend/turing/pool.ts` |
| Ingestion coupling window | 180 values | (fixed) | `backend/worker/ingest-loop.ts` |

When a cap is exceeded, the oldest entries are dropped (ring-buffer or splice). This is the primary “delete waste” mechanism in the backend.

### Supabase

- **clean_raw_window** (RPC): Called by the ingestion worker and full-stack mission. Drops or archives raw rows outside a time window so raw tables do not grow unbounded. See `backend/worker/ingest-loop.ts` (invokeCleanupRpc) and `backend/scripts/full-stack-mission.ts`.
- Other RPCs (**generate_nowcast_5s**, **compute_mms_recon_vectors_5s**, **build_aurora_healpix_map**) produce derived products; retention of derived data is defined by schema and any cleanup policies in the database.

### Frontend

- **React Query:** Stale time and cache time (gcTime) limit how long data is kept in the client. See [DATA_FETCHING_OPTIMIZATION.md](DATA_FETCHING_OPTIMIZATION.md) (e.g. 1–24 hour cache depending on data age).
- **Optimization directive:** Store only the last 50 events in React state for telemetry-style logs; drop the rest to avoid browser tab memory growth.

### Data analysis models and waste

Models above (probability engine, imputer, multi-agent, nowcast, probability gate) consume **bounded inputs**: either the capped in-memory feeds, or explicitly limited request payloads. No model is fed unbounded history. Downstream cleanup (`clean_raw_window`, feed shift on cap, frontend cache gc) keeps storage and memory bounded. No additional code is required for “delete waste” beyond the existing caps and RPCs; this section documents the link between models and retention so it is traceable.

---

## Optional: smoke test for retention

To confirm raw tables are pruned after cleanup:

1. Run the full-stack mission including Phase 4 (controlled Supabase write and cleanup): `npm run test:fullstack`.
2. In Supabase (SQL or dashboard), inspect row counts for `sw_raw_samples` (and related raw tables) before and after the mission run; after `clean_raw_window`, counts should stay within the configured window (e.g. time-bounded).

This can be added as a manual checklist in [QA_TEST_PLAN.md](QA_TEST_PLAN.md) under a “Retention / cleanup” subsection if desired.
