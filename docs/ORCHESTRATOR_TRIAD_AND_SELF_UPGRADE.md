# Orchestrator Triad Pipeline and Self-Upgrade

Rust-first automation with minimal external apps: the orchestrator drives the Triad (Surya → DeepSeek) via direct API and uses the same codebase to upgrade itself via the work queue.

## Lights-Out Watchdog

- **Watched directory:** `ORCHESTRATOR_TELEMETRY_DIR` (default **`./telemetry_drop`**). When a CSV or packet file lands, the Rust watcher (OS-level `notify`, no polling) triggers processing.
- **No spin loops:** The watcher thread uses `thread::park()`; CPU sleep when idle.

## Triad Pipeline (Direct API)

1. **Orchestrator** sees a CSV in `telemetry_drop` → runs existing sensitivity routing and, if **`ORCHESTRATOR_TRIAD_ON_CSV=true`** and **`ORCHESTRATOR_PIPELINE_API_URL`** is set, POSTs `{ "sourcePath": "<path>" }` to the backend at **`POST /api/ops/pipeline/triad`**.
2. **Backend** (Express) runs the single Python script **`scripts/triad_pipeline.py`** with that path. The script:
   - **Worker A (Surya):** stub or real Surya forecast; then `gc.collect()` + cache clear.
   - **Worker B (DeepSeek):** calls local engine at `ORCHESTRATOR_LOCAL_ENGINE_URL` / `GAUSS_BRAIN_URL`; then unload/GC.
   - Prints one JSON report to stdout.
3. **Backend** returns that report in the HTTP response.
4. **Orchestrator** receives the report, applies the **Sovereign Buffer** (`anonymize_payload()` in Rust), then optionally POSTs the scrubbed report to the Cloud LLM (Worker C) for a Daily Mission Summary and writes **`reports/daily-summary.txt`**.

No n8n or extra daemons; all orchestration and scrubbing in Rust, backend runs one script.

## Sovereign Buffer (Rust)

- **`anonymize_telemetry(text)`** – legacy CSV/telemetry string (Satellite_ID_ → Asset_, Lat/Lon redaction).
- **`anonymize_payload(json_str)`** – JSON report: strips sensitive keys (e.g. `satellite_id`, `orbital_vector`, `latitude`, `longitude`) and redacts patterns in string values before any cloud export.

## Env (Orchestrator)

| Variable | Purpose |
|----------|---------|
| `ORCHESTRATOR_TELEMETRY_DIR` | Watch folder (default `./telemetry_drop`) |
| `ORCHESTRATOR_PIPELINE_API_URL` | Backend base URL for triad (e.g. `http://127.0.0.1:3001`) |
| `ORCHESTRATOR_TRIAD_ON_CSV` | If set, trigger triad on each CSV drop |
| `ORCHESTRATOR_OPENAI_API_KEY` or `OPENAI_API_KEY` | Optional: Cloud LLM for daily summary |

## Orchestrator Upgrades Itself

- **Autonomous code analysis:** `ORCHESTRATOR_ANALYZE_AT_STARTUP=true` runs the code indexer and multi-agent analysis, then writes **`reports/orchestrator/work-queue.json`**.
- **Work queue:** Cursor rule and **agents-project-manager** read that file to coordinate subagents (explore, shell, cyber-devops, etc.). So the orchestrator produces the backlog; the project-manager and Cursor agents execute it.
- No separate “upgrade” app: the same binary that watches telemetry and runs the Triad also runs code analysis and emits the work queue.

## 6GB / Apollo Constraints

- **One LLM at a time** in the Python script (Surya then GC, then DeepSeek then GC).
- **Polars:** use `scan_csv` / `scan_parquet` in any new Python data paths; no full-dataset load.
- **Rust:** zero-copy and minimal allocations in pipeline and anonymization.
- **No polling:** event-driven watch and async HTTP only.
