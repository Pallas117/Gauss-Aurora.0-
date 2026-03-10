# Wiring and Redundancies

This document summarizes how services and configuration are wired and where fallbacks or redundancy exist so the system degrades gracefully when components are unavailable.

## Configuration fallbacks

### Backend env

- **Supabase:** `SUPABASE_URL` or `VITE_SUPABASE_URL`; `SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`; `SUPABASE_SERVICE_ROLE_KEY`. See [backend/supabase.ts](backend/supabase.ts). Placeholder values (`your-project.supabase.co`, `.example.com`) are treated as unset; callers get `null` and skip DB-dependent paths.
- **Local chat / Gauss Brain:** `ORCHESTRATOR_LOCAL_ENGINE_URL` ?? `GAUSS_BRAIN_URL` ?? `MLX_CHAT_URL`. If none set, startup check is skipped (no failure). See [backend/scripts/local-chat-engine-check.ts](backend/scripts/local-chat-engine-check.ts).
- **Decoder API:** `ORCHESTRATOR_DECODE_API_BIND`; when unset, CCSDS decode can still be routed to orchestrator or stub. See [backend/decoder-registry.ts](backend/decoder-registry.ts).

### Frontend env

- **API base URL:** `VITE_HELIO_PROXY_URL` with fallback to `http://localhost:3001` where used (hooks, boot-checks, API modules). Some modules also read `process.env.VITE_HELIO_PROXY_URL` for test/SSR.
- **Supabase (client):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; placeholders produce auth warnings. See [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts) and [src/lib/auth-env-check.ts](src/lib/auth-env-check.ts).
- **RAG:** `VITE_GAUSS_RAG_URL` with fallback `http://localhost:3002` in [src/hooks/useAgenticEvaluator.ts](src/hooks/useAgenticEvaluator.ts).

## Service redundancy and degradation

### Data feeds (ingestion)

- **Space weather sources:** NOAA, ESA, JAXA, MMS (CDAWeb/LASP). Each fetch is independent; missing NOAA marks point stale/low-confidence; missing ESA/JAXA/MMS degrades quality flags but ingestion continues. See [backend/worker/ingest-loop.ts](backend/worker/ingest-loop.ts).
- **Risk zones:** Privateer API if `PRIVATEER_API_URL` set, else open-catalog (e.g. CelesTrak). Failure is caught and logged; previous snapshot retained. Same for satellite objects.
- **Supabase writes:** If Supabase is not configured or RPC fails, worker logs and continues; in-memory canonical/MMS/aurora state still updates. DB write and RPC (clean_raw_window, generate_nowcast_5s, build_aurora_healpix_map) failures are non-fatal. Aurora RPC is tried with multiple parameter signatures for compatibility. See [backend/worker/ingest-loop.ts](backend/worker/ingest-loop.ts).

### API response chain (backend)

- **GET /api/feed/space-weather/latest:** Redis cache → Influx (if configured) → Supabase fetch → in-memory `getLatestCanonical()`. First successful source wins. See [backend/server.ts](backend/server.ts).
- **GET /api/feed/mms/reconnection and .../latest:** Same idea: cache → Supabase → in-memory feed.
- **GET /api/feed/aurora/map:** Redis cache → in-memory `getAuroraMap()` → Supabase fetch.

### Caches and optional services

- **Redis:** [backend/redis-cache.ts](backend/redis-cache.ts). `getRedis()` returns `null` if `REDIS_URL` unset or connect fails; `cacheGet`/`cacheSet` no-op or return null on error. Feed routes then use Influx/Supabase/memory.
- **InfluxDB:** `isInfluxConfigured()`; when false, feed routes skip Influx and use Supabase/memory.
- **Kafka:** Used for raw telemetry produce; failure is logged; ingestion continues. See [backend/kafka.ts](backend/kafka.ts).

### Auth and ingest token

- **Service token:** Backend accepts `x-gauss-service-token` or `Authorization: Bearer <token>`; value must match `ORCHESTRATOR_INGEST_API_TOKEN`. If unset, ingest auth rejects. No fallback for ingest API.

### Turing / compute

- **Turing pool:** Optional; when disabled or unreachable, cache and compute dispatch no-op or return empty. See [backend/turing/pool.ts](backend/turing/pool.ts), [backend/turing/cache-proxy.ts](backend/turing/cache-proxy.ts), [backend/turing/compute-dispatcher.ts](backend/turing/compute-dispatcher.ts).

### Frontend boot and health

- **Backend health:** [src/lib/boot-checks.ts](src/lib/boot-checks.ts). Failure reports "Backend unreachable. Using offline cache if available." Session and auth-config checks can still run; app continues with degraded data.
- **Auth config:** Missing or placeholder Supabase env shows a banner; sign-in disabled until fixed.

## Optional vs required

| Component        | Required for core run | Redundancy / fallback |
|-----------------|------------------------|------------------------|
| Supabase        | Yes (auth + optional DB) | Backend uses URL/key fallbacks; worker skips DB writes if unset. |
| Backend (API)   | Yes for UI data       | Frontend boot check degrades to offline/cache message. |
| Gauss Brain / MLX | No                  | Startup check skipped if URL unset; stub or MLX for chat only. |
| Redis           | No                    | Feed routes fall back to Influx/Supabase/memory. |
| InfluxDB        | No                    | Feed routes use Redis/Supabase/memory. |
| Kafka           | No                    | Produce failure logged; ingestion continues. |
| Privateer       | No                    | Risk zones use open-catalog when Privateer URL unset. |
| Turing pool     | No                    | Cache/compute no-op when disabled. |

## Adding or changing wiring

- **New optional service:** Prefer `getX()` returning `null` when unset or failing, and callers that no-op or use a fallback chain (e.g. cache → DB → memory).
- **New env key:** Prefer one primary key with a single fallback (e.g. `SUPABASE_URL \|\| VITE_SUPABASE_URL`) and document in [.env.example](.env.example) and [backend/scripts/check-env.ts](backend/scripts/check-env.ts) (required: false for optional).
- **Frontend API base:** Use the same pattern as existing hooks: `(import_meta?.env?.VITE_HELIO_PROXY_URL ?? process?.env?.VITE_HELIO_PROXY_URL) ?? "http://localhost:3001"` so tests and SSR can override.
