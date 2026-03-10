# Pass Orchestration API

The Pass API is an HTTP service in the Gauss orchestrator that provides API-first pass planning, scheduling, antenna commands, and network routing for ground-segment automation. It is enabled when `ORCHESTRATOR_PASS_API_ENABLED=true` and binds to `ORCHESTRATOR_PASS_API_BIND` (default `127.0.0.1:8091`).

## Endpoints

| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET | `/health` | Liveness and dependency status (scheduler, antenna) | All |
| GET | `/passes` | List all pass windows | viewer+ |
| POST | `/passes/plan` | Plan a new pass (may conflict) | operator+ |
| GET | `/passes/:id` | Get a pass by ID | viewer+ |
| POST | `/passes/:id/schedule` | Schedule a planned pass | operator+ |
| POST | `/passes/:id/track/:antenna_id` | Start tracking pass on antenna | admin |
| POST | `/antennas/:id/point` | Slew antenna to az/el | admin |
| POST | `/antennas/:id/stop` | Stop antenna motion | admin |
| GET | `/antennas/commands` | Command log (optional `limit`, `pass_id`) | viewer+ |
| GET | `/network/links` | List DTN links | viewer+ |
| POST | `/network/links/upsert` | Upsert link | admin |
| POST | `/network/route/plan` | Plan transfer route | admin |
| GET | `/network/audit` | DTN/ISL audit report | viewer+ |
| GET | `/telegram/feed` | Telegram feed (optional `limit`) | viewer+ |
| GET | `/automation/approvals` | Approval gate feed | viewer+ |
| GET | `/audit` | Audit log (mutations + 403), optional `limit` | admin |

## Health and dependencies

`GET /health` returns JSON with:

- `ok`, `service`, `timestamp`
- `dependencies.scheduler`: `status` (`ok` / `error`) and `pass_count`
- `dependencies.antenna`: `status` (e.g. `mock`)

Use this for readiness checks and dependency status.

## Persistence

- **Scheduler:** When `ORCHESTRATOR_PASS_STORE_PATH` is set, pass windows are persisted to a JSON file at that path. On startup the scheduler loads from the file; on each successful `plan_pass` or `schedule_pass` it writes back. If the path is unset, the scheduler is in-memory only.

## Conflict response and suggested alternatives

- On **window conflict** (overlapping pass on the same station), the API returns **409 Conflict** with a body that includes:
  - `code`, `message`
  - `suggested_alternatives`: optional array of `{ start, end }` (next free windows on that station, up to 3), with minimum duration the requested window or 5 minutes.

Deterministic tie-breaking is applied so the same inputs produce the same conflict and alternatives.

## Antenna commands: idempotency and log

- **Idempotency:** For `point_antenna`, `track_pass`, and `stop_antenna`, the request body may include `idempotency_key`. If the same key was already used for the same (antenna/pass, command type), the server returns the same `CommandReceipt` without re-issuing. A bounded cache (e.g. 100 entries) is used to avoid unbounded growth.
- **Command log:** Every antenna command (and idempotent replay) is appended to an in-memory command log. `GET /antennas/commands` returns recent entries with optional `limit` (default 50, max 200) and `pass_id` filter.
- **Config:** `ORCHESTRATOR_ANTENNA_COMMAND_TIMEOUT_SECS` and `ORCHESTRATOR_ANTENNA_COMMAND_RETRIES` are available for future real adapters; the mock adapter ignores them.

## RBAC

- **Roles:** `viewer`, `operator`, `admin` (case-insensitive).
- **Source:** Request header `X-Gauss-Role` or `X-Pass-API-Role`; if missing, `ORCHESTRATOR_PASS_API_DEFAULT_ROLE` is used (default `operator`).
- **Permissions:**
  - **viewer:** GET only.
  - **operator:** GET + `POST /passes/plan` + `POST /passes/:id/schedule`.
  - **admin:** All endpoints (including antenna commands, network mutations, `GET /audit`).
- Unauthorized access returns **403 Forbidden** and the attempt is recorded in the audit log.

## Audit log

- **Scope:** Mutations (POST/PUT/PATCH/DELETE) and every 403 response.
- **Fields:** `request_id`, `actor_id`, `role`, `timestamp`, `method`, `path`, `status` (HTTP code), optional `body_digest`.
- **Actor:** From header `X-Actor-Id` or `"anonymous"`.
- **Request ID:** Each request gets a UUID; it is set on the response header `X-Request-Id` and included in the audit entry and error JSON where applicable.
- **Storage:** In-memory, capped at `ORCHESTRATOR_PASS_API_AUDIT_MAX_ENTRIES` (default 1000).
- **Access:** `GET /audit` (admin only), with optional query `limit` (default 100, max 500).

## References

- Implementation: `gauss-orchestrator/src/pass_api.rs`, `gauss-orchestrator/src/pass_domain.rs`
- Config: `gauss-orchestrator/src/config.rs` (`pass_store_path`, `pass_api_default_role`, `pass_api_audit_max_entries`, antenna timeout/retries)
- Plan: Pass orchestration API and scheduler (GAUSS-COMP-101–104)
