# Testing the app from Cursor

This project is wired so you can run and test it from Cursor with **only the local chat model** (no cloud keys).

## Quick run and test

1. **Env**  
   Copy the local chat section from `.env.example`. **Default is MLX DeepSeek on port 8088**:
   - `GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1`
   - `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions`
   - `ORCHESTRATOR_CHAT_MODEL=DeepSeek-R1-Distill-Qwen-1.5B-4bit`  
   To use the stub instead, set both URLs to port **8089** and run `npm run dev:brain:stub`.

2. **Start MLX DeepSeek (recommended)**  
   In one terminal, start the local model (requires `pip install mlx mlx-lm`):
   ```bash
   npm run dev:brain:mlx
   ```
   This runs `mlx_lm.server` with DeepSeek-R1-Distill-Qwen-1.5B-4bit on port 8088 and `--cache-limit-gb 2.5`.

3. **Start the app and run the local-chat test**  
   In another terminal:
   ```bash
   npm run dev:proxy
   ```
   Then `npm run test:local-chat`. You should see:
   - `[startup] Local chat engine: OK (ready for orchestrator / Cursor testing)` once MLX is up
   - `[test-local-chat-engine] OK – local chat engine responded with parseable content.`

   Or use `npm run dev:stack:local` to start frontend + backend + **stub** (8089) and run the test; for MLX use `dev:brain:mlx` in a separate terminal and point `.env` at 8088.

## What’s tied to the app

- **Backend startup**: On listen, the backend runs a one-off check of the local chat engine and logs `[startup] Local chat engine: OK | not configured | <error>`.
- **Script**: `npm run test:local-chat` hits the same engine (same contract as the orchestrator). Use it anytime to confirm the local model is reachable.
- **Offline defaults**: The gauss-orchestrator defaults to the local engine and cloud off, so the app can run without any other model when the stub or your MLX server is on 8089 (or the URL you set).

## Using your MLX DeepSeek server

Point the env at your server, e.g.:
- `ORCHESTRATOR_LOCAL_ENGINE_URL=http://localhost:8080/v1/chat/completions`
- `GAUSS_BRAIN_URL=http://localhost:8080/v1`  
Then run `npm run dev:stack` (no stub needed). **Your MLX server must be running on that port** or you’ll get connection refused.

## Troubleshooting: Error -102 / connection refused to localhost:8080

If you see **Error Code: -102** with **URL: http://localhost:8080/v1/chat/completions**:

- **-102** is connection refused: nothing is listening on that host:port.
- **Port 8080** in this repo is the Vite dev server (frontend). The **local chat stub** runs on **port 8089**.

**Fix:** Use port **8089** for the chat engine unless you’re actually running MLX (or another OpenAI-compatible server) on 8080. In your `.env` set:
- `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8089/v1/chat/completions`
- `GAUSS_BRAIN_URL=http://127.0.0.1:8089/v1`  
Then start the stub: `npm run dev:brain:stub` (or run `npm run dev:stack` which starts it for you).

To see what is using the brain port: `npm run port:brain` (or run `lsof -nP -iTCP:8089 -sTCP:LISTEN`).

## Backend, Supabase, and orchestrator tests

- **Backend**: `npm test` runs backend unit/contract tests; `npm run check:backend-env` validates Supabase and other env (used in CI).
- **Supabase / RBAC**: `npm run test:rbac` (viewer/operator/admin role gating); `npm run test:supabase-rls` (RLS: authenticated SELECT allowed, raw INSERT denied).
- **Full-stack**: `npm run test:fullstack` runs health, API contracts, RBAC, Supabase Phase 4 write/cleanup, and optionally orchestrator ingest E2E when `ORCHESTRATOR_INGEST_API_TOKEN` is set.
- **Orchestrator**: `npm run test:orchestrator` runs Rust tests (packet ingest contract vs mock backend).
- **Full adherence audit**: `npm run audit:adherence` runs lint, tests, orchestrator tests, build, and other checks; when `ORCHESTRATOR_INGEST_API_TOKEN` is set it also runs **Orchestrator ingest E2E** (POST one canonical packet) and **Orchestrator live ingest (one file)** (Rust binary processes `gauss-orchestrator/tests/fixtures/ccsds_valid.bin` and POSTs to the backend; backend must be running). If the token is unset, those checks are reported as WARN.

## Progress in the full build (full audit plan)

See [AUDIT_STEPS.md](AUDIT_STEPS.md) for the numbered list of audit steps (Step 8 = Security Compliance Mapping).

Progress in the full build is measured by the **full adherence audit** plus the **progress checker**: the audit writes `reports/progress/requirements-audit.latest.json`, and the progress checker reads it and gates the V0.2 score (see `tools/progress-checker/gauss_progress_bar.py`). To refresh and see progress in one go: `npm run progress:short:refresh`.

The **orchestrator** reports this same progress when you use it from the workspace root:

- **Telegram `/audit`** — Runs `npm run audit:adherence:record`, then `npm run progress:short`, and sends audit output plus the one-line progress summary (e.g. `GAUSS_PROGRESS overall=78% V0.2=78%`) to Telegram.
- **Telegram `/progress`** — Runs `npm run progress:short:refresh` (audit then progress) and sends the progress line to Telegram.
- **Periodic audit automation** — When `ORCHESTRATOR_AUDIT_AUTOMATION_ENABLED=true`, each cycle runs the audit, parses totals, runs `npm run progress:short`, and includes the progress line in the cycle summary (PASS/WARN/FAIL plus progress).

Run the orchestrator from the **workspace root** so `npm run audit:adherence:record` and `npm run progress:short` use the root `package.json` scripts.

See **QA Test Plan** (§7 Backend, Supabase, and Orchestrator Test Matrix) and the **Backend and Supabase Testing Plan** for the full test matrix and Supabase agent RLS prompts.
