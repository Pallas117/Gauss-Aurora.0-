# Architecture Refinements

This document compares the **documented architecture** (e.g. `ARCHITECTURE.md`) with the **current codebase** and suggests refinements for clarity, maintainability, and automation.

---

## 1. Documented vs Actual Architecture

### What ARCHITECTURE.md Describes

- **Backend**: A single “Edge Function” (e.g. `spaceweather/index.ts`) with Fetcher → Validator → Normalizer → Cache Manager → Spike Rejection → compact JSON.
- **Frontend**: Data state manager, 3D renderer (Three.js), UI layer, performance monitor, shader modules.
- **Data flow**: External sources (NOAA, NASA DSCOVR, NOAA GOES, fallback cache) → backend → frontend over HTTPS.

### What the Codebase Actually Has

The **backend** is a full Express server (`backend/server.ts`, 2000+ lines) that includes:

| Area | Components |
|------|------------|
| **Data ingestion** | `IngestionWorker` (`worker/ingest-loop.ts`) with adapters: NOAA SWPC, ESA HAPI, JAXA ERG, MMS CDAWeb, MMS LASP. Canonical feed, MMS reconnection, aurora map, source status. |
| **API surface** | `/health`, `/api/auth/session`, space-weather feeds (5s, latest), MMS reconnection, aurora map, sources status, threats, dashboard, ops/command, network audit, mission core snapshot, Turing devices/cache/compute, CyberTiger status, feedback, packet ingest, chat. |
| **Security** | CyberTiger daemon (rate limit, blocklist, audit), RBAC (viewer/operator/admin), CORS, security headers, authenticated WebSocket. |
| **Contracts** | Mission-core, heliophysics, packet-ingest contract assertions. |
| **ML / inference** | ML client (nowcast, training), probability gate (pre-inference gating). |
| **Distributed** | Turing pool (Tailscale devices: registration, heartbeat, cache proxy, compute dispatcher). |
| **Telemetry** | Packet ingest endpoint, decoder sampling, optional orchestrator integration (XTCE, APID map). |

The **frontend** still matches the high-level picture (3D scene, hooks, UI), but the **backend** is no longer a single edge function; it’s a monolithic API server with many responsibilities.

---

## 2. Suggested Refinements

### 2.1 Update ARCHITECTURE.md

- **Replace** “Edge Function” with “Backend API server (Express)” and add a high-level block diagram for:
  - External data sources
  - Ingestion worker (adapters → canonical/MMS/aurora/source status)
  - HTTP/WS API (auth, feeds, ops, Turing, CyberTiger, ingest)
  - Optional: Turing pool, orchestrator, ML
- **Add** a short “Security & RBAC” subsection (CyberTiger, roles, CORS).
- **Add** a “Key routes” table (e.g. `/health`, `/api/feed/*`, `/api/ops/*`, `/api/turing/*`, `/api/security/cybertiger/*`, `/api/ingest/*`) with one-line descriptions.
- **Keep** the frontend and data-model sections; add a note that the backend output schema in the doc is the canonical space-weather shape; other endpoints have their own payloads.

### 2.2 Backend Structure

- **Current**: One large `server.ts` (routes, middleware, helpers in a single file).
- **Refinement**: Over time, consider:
  - **Route modules**: e.g. `routes/feed.ts`, `routes/ops.ts`, `routes/turing.ts`, `routes/auth.ts`, `routes/ingest.ts`, and mount them in `server.ts`. This improves readability and testability without changing behavior.
  - **Middleware**: Keep CORS/security in one place; optional `middleware/auth.ts` for `authenticateRequest` / `requireRole` if reused elsewhere.
- **No change required immediately**; treat as a maintainability improvement when touching those areas.

### 2.3 Configuration and Automation

- **Single entry point**: Provide `npm run start` as the default “run the app” command (frontend + backend + brain stub). **Done** (see README and PROJECT_GAUSS_PLAIN_ENGLISH.md).
- **Env check before start**: Optional script (e.g. `scripts/start-with-env-check.sh`) that runs `check:backend-env` and then `npm run start` so first-time users get a clear error if `.env` is missing or invalid.
- **Docs**: Point non-coders to `docs/PROJECT_GAUSS_PLAIN_ENGLISH.md`; point developers to `ARCHITECTURE.md` and this refinements doc.

### 2.4 Security and Compliance

- **Already documented**: CyberTiger, RBAC, and NIST/ISO mapping are in `CYBERTIGER_COMPLIANCE_BASELINE.md`.
- **Refinement**: In ARCHITECTURE.md, add a one-paragraph “Security” summary and reference `CYBERTIGER_COMPLIANCE_BASELINE.md` and `RELEASE_CHECKLIST.md` (security gates).

### 2.5 Data Flow Clarity

- **Ingestion**: Document that the ingestion worker runs inside the same Node process as the Express server; it uses `state.ts` (and Supabase) to store canonical feed, MMS, aurora map, and source status. No separate “edge function” for space weather; the server both ingests and serves.
- **Contracts**: Mention that mission-core, heliophysics, and packet-ingest contracts are asserted at startup or on key requests to ensure API shape and integration consistency.

---

## 3. Summary

| Refinement | Priority | Status |
|------------|----------|--------|
| Plain-English guide for non-coders | High | Done: `docs/PROJECT_GAUSS_PLAIN_ENGLISH.md` |
| One-command start (`npm run start`) | High | Done: alias for `dev:stack` |
| Update ARCHITECTURE.md to match backend | Medium | **Done**: block diagram, key routes, security ref |
| Optional env-check wrapper for `start` | Low | Optional script |
| Split backend routes into modules | Low | Future maintainability |

The codebase is **more capable** than the original architecture doc (full API, ingestion, security, Turing, ML). The main refinement is **documentation**: keep ARCHITECTURE.md aligned with the real system and give non-coders a single, code-free guide and a single start command.
