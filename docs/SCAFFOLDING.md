# Gauss Scaffolding Guide

## Backend Feature Module Scaffold

Generate a new backend feature module:

```bash
npm run scaffold:backend-feature -- --name noaa-cme-alerts
```

This creates:

- `backend/features/<name>/<name>.types.ts`
- `backend/features/<name>/<name>.service.ts`
- `backend/features/<name>/<name>.service.test.ts`
- `backend/features/<name>/index.ts`

## Test and Debug Scaffolds (Orchestrator)

Use the orchestrator to optimise tests and debug with scaffolded profiles and a dedicated debug sweep.

**1. Generate debug profile and work-queue**

```bash
npm run scaffold:test-debug
```

This writes:

- `reports/orchestrator/debug-profile.json` — lower battery floor, single-thread Rust tests, skip heavy UI/Playwright by default, verbose sweep report.
- `reports/orchestrator/work-queue.json` — `min_safe_battery_percent: 10` and `debug: true` so the sweep uses a lower battery floor.

**2. Run the full E2E sweep in debug mode**

```bash
npm run test:sweep:debug
```

Equivalently: `ORCHESTRATOR_DEBUG=true FULL_E2E_SWEEP=true npm run test:sweep` (or run `orchestrate-tests.ts` with those env vars). When `ORCHESTRATOR_DEBUG=true`, the orchestrator:

- Loads `reports/orchestrator/debug-profile.json` if present.
- Uses a lower battery floor from the scaffold (or work-queue).
- Skips heavy UI E2E and Playwright by default (override by editing `debug-profile.json`: set `skip_ui_e2e` / `skip_playwright` to `false`).
- Runs Rust tests with `--nocapture --test-threads=1` (`npm run test:orchestrator:debug`) for easier trace.
- Writes `reports/orchestrator/sweep-debug.json` with profile, battery, failures, and `completedAt` for diagnosis.

**3. Backend env check (alias)**

```bash
npm run check-env
```

Runs the same backend env sanity check as `check:backend-env` (used in Phase 0 of the sweep). Use before or after scaffold to confirm required vars (e.g. Supabase) are set.

**4. One-off debug runs**

- Rust orchestrator only, verbose: `npm run test:orchestrator:debug`
- Playwright with debug UI: `npm run test:ui:debug`
- Full sweep (no debug profile): `npm run test:sweep`

See [ORCHESTRATOR_REFINEMENT.md](ORCHESTRATOR_REFINEMENT.md) for analysis and [backend/scripts/orchestrate-tests.ts](../backend/scripts/orchestrate-tests.ts) for the sweep phases.

## Typed API Contract Scaffold

Frontend API contracts are centralized in:

- `src/lib/contracts/heliophysics.ts`

Backend response contract scaffolds live in:

- `backend/contracts/heliophysics-contract.ts`

Use these contracts before consuming or emitting payloads to detect schema drift early.

## Realtime Feed Hook Scaffold

Reusable polling hook:

- `src/hooks/useRealtimeFeed.ts`

Use it for any feed with regular cadence polling and shared state:

- `loading`
- `error`
- `lastUpdated`
- `refresh()`

## Backpropagation Context Scaffold

**Full backpropagation** (audit + capsule + reflection): see [BACKPROP_RUNBOOK.md](BACKPROP_RUNBOOK.md). Run:

```bash
npm run backprop:full
```

Then block 1 hour to reflect using [reports/context/reflection-template.md](../reports/context/reflection-template.md), and create `reports/context/YYYY-MM-DD-learnings.md`.

**Single capsule only** (no audit refresh):

```bash
npm run context:backprop
```

Outputs:

- `reports/context/latest-backprop.json`
- `reports/context/latest-backprop.md`
- timestamped copies in `reports/context/`

What it includes:

- Current branch/worktree pressure (modified/staged/untracked/conflicts)
- Progress checker state and milestone deficits
- Highest-leverage "backprop" actions from missing requirements
- Current route map (`src/app/routes.tsx`) and critical API endpoints (`backend/server.ts`)

Quick shell summary:

```bash
npm run context:backprop:short
```

## Process Stack Merge

Use merged process scripts to run fewer terminal sessions:

```bash
npm run dev:stack
```

Starts:
- frontend (`vite`)
- backend proxy (`backend/server.ts`)
- brain stub (`backend/scripts/gauss-brain-stub.ts`)

Full stack including Rust orchestrator:

```bash
npm run dev:stack:full
```

Orchestrator launcher is:
- `scripts/process/run-orchestrator.sh`
- check binary path: `bash scripts/process/run-orchestrator.sh --check`

Battery-safe mode (reduced polling + low-power ingest profile):

```bash
npm run dev:battery
```

Include brain stub if needed:

```bash
npm run dev:battery:full
```

Prune stale dev listeners before launch:

```bash
npm run dev:prune:dry
npm run dev:prune
```

## CCSDS + XTCE Packet Ingest Scaffold

Packet decode is now available in the Rust orchestrator behind a feature flag:

```bash
ORCHESTRATOR_DECODE_ENABLED=true npm run dev:orchestrator
```

Supported watched file extensions:

- `.csv` (legacy path unchanged)
- `.bin`, `.hex`, `.ccsds` (CCSDS decode path)

Core decoder environment variables:

- `ORCHESTRATOR_DECODE_ENABLED` (default `false`)
- `ORCHESTRATOR_XTCE_PATH` (default `./gauss-orchestrator/config/xtce/baseline.xtce.xml`)
- `ORCHESTRATOR_APID_MAP_PATH` (default `./gauss-orchestrator/config/xtce/apid-map.json`)
- `ORCHESTRATOR_INGEST_API_URL` (default `http://127.0.0.1:3001/api/ingest/telemetry/packets`)
- `ORCHESTRATOR_INGEST_API_TOKEN` (service token shared with backend auth bypass for restricted ingest)
- `ORCHESTRATOR_PACKET_MAX_BATCH` (default `250`)
- `ORCHESTRATOR_PACKET_MAX_BYTES` (default `1048576`)
- `ORCHESTRATOR_PACKET_CRC_ENABLED` (default `false`)

Backend packet ingest endpoint:

- `POST /api/ingest/telemetry/packets`

Ops status extension:

- `GET /api/ops/command/latest` now includes `decoderStatus`.

## DTN + ISL Network Management Audit

Run the dedicated DTN/ISL gate:

```bash
npm run check:network-management
```

Runtime behavior:

- Static checks validate DTN/ISL module + route wiring.
- If `ORCHESTRATOR_PASS_API_ENABLED=true`, the audit also pings the live pass API network audit endpoint.

Pass API network routes:

- `GET /network/links`
- `POST /network/links/upsert`
- `POST /network/route/plan`
- `GET /network/audit`

Backend ops routes:

- `GET /api/ops/command/latest` includes `dtnIslStatus`
- `GET /api/ops/network/audit` (operator role)

## Secure Connectivity Agent (Hotspot -> Wi-Fi Failover)

Use the local network security/connectivity agent to keep dev sessions secure while mobile:

```bash
npm run network:secure
```

Apply network ordering and SSID switching (approval-gated through Telegram by default):

```bash
npm run network:secure:apply
```

Continuous mode:

```bash
npm run network:secure:watch
```

Runtime outputs:

- `reports/network/connectivity-feed.jsonl`
- `reports/network/connectivity-latest.json`

Key env vars:

- `GAUSS_PRIMARY_HOTSPOT_SSID`
- `GAUSS_PRIMARY_HOTSPOT_PASSWORD`
- `GAUSS_SECONDARY_WIFI_SSID`
- `GAUSS_SECONDARY_WIFI_PASSWORD`
- `GAUSS_PRIMARY_NETWORK_SERVICE`
- `GAUSS_SECONDARY_NETWORK_SERVICE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GAUSS_NETWORK_APPROVAL_TIMEOUT_SECS`
- `GAUSS_NETWORK_AUTO_APPROVE` (set `true` only for trusted unattended mode)
