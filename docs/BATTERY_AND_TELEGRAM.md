# Battery and Telegram

For the full power-optimisation architecture (backend cadences, frontend adaptive polling, battery gate, and where power is consumed), see [ARCHITECTURE.md — Power optimisation architecture](ARCHITECTURE.md#power-optimisation-architecture).

## Battery / power

- **Backend**: Set `POWER_SAVE_MODE=true` and/or `INGEST_POWER_PROFILE=low-power` in `.env` to use longer ingest intervals and reduce CPU use.
- **Charging-flow adaptive ingest**: Ingest cadence now adapts to battery charging flow:
  - Discharging state applies stronger backoff and lower aurora map resolution.
  - Charging below 50% keeps a mild backoff to improve net recharge.
  - Modes: `INGEST_CHARGING_FLOW_MODE=recharge-first|balanced|performance` (default `balanced`).
  - Controls: `INGEST_ADAPTIVE_CHARGING_FLOW=true|false` (default `true`), `INGEST_POWER_FLOW_SAMPLE_MS` (default `60000`), optional battery overrides `BATTERY_PERCENT`, `BATTERY_CHARGING`, `BATTERY_POWER_SOURCE`.
- **Frontend**: Set `VITE_POWER_PROFILE=low-power` so polling uses longer intervals; the UI also respects `navigator.connection.saveData` and backs off when the tab is hidden.
  - Modes: `VITE_BATTERY_DRAIN_MODE=recharge-first|balanced|performance` (default `balanced`).
- **Orchestrator**: Uses event-driven watchers and `tokio::time::sleep` for audit intervals (no spin loops). Default audit interval is 30 minutes.
- **MLX DeepSeek**: The local model uses the GPU and will increase power use while it is running. To avoid draining the battery:
  - Run `npm run dev:brain:mlx` only when you need local chat (e.g. testing or offline use).
  - Stop the MLX process when not in use, or rely on the stub (`npm run dev:brain:stub`) for lightweight testing.
  - On a laptop, prefer being plugged in when running MLX for long sessions.

The project directive (no spin loops, probability gating so the LLM stays dormant until 3-sigma) is already aligned with lower power use; the main extra draw is MLX when you choose to run it.

**Battery safety floor:** For stakeholder demo and high-value devices, heavy work is gated by `min_safe_battery_percent` (work queue default 25), and a higher discharging floor can apply when unplugged. The **full-adherence-audit**, **backprop**, and **test sweep** honor the charging-aware floor, so they back off sooner when battery is draining and relax when charging is healthy.

### Measuring power and CPU

There is no in-app power/CPU instrumentation. To see how much the stack uses:

- **macOS Activity Monitor**
  - **CPU:** Open Activity Monitor → CPU tab, sort by % CPU. Start Gauss (`npm run dev`, `npm run dev:proxy`, optionally orchestrator or MLX), then note Node, Vite, and any Python/Rust processes.
  - **Energy:** Activity Monitor → Energy tab shows “Energy Impact” and “12 hr Power” per process. Compare: (1) idle laptop, (2) Gauss frontend + API only, (3) + ingest worker, (4) + orchestrator, (5) + MLX if used.
- **macOS powermetrics (optional)**  
  - For CPU package power (Watts) over ~30 s:  
    `sudo powermetrics --samplers cpu_power -i 5000 -n 6`  
  - Run with Gauss up to compare “backend + worker” vs “backend only.”

To measure the effect of optimizations, use Activity Monitor (Energy and CPU) before and after switching to `npm run dev:battery` or changing power-related env.

### For day-to-day laptop use

When you need the laptop for other work and want Gauss running in the background with lower power and CPU:

1. **Use the battery preset:** Run `npm run dev:battery` instead of `npm run dev` + `npm run dev:proxy`. This sets `VITE_POWER_PROFILE=low-power`, `VITE_POLL_INTERVAL_MULTIPLIER=2`, `POWER_SAVE_MODE=true`, `INGEST_POWER_PROFILE=low-power`, and disables the helio WebSocket so the frontend and backend use longer intervals and the 3D scene throttles.
2. **Optional: low-power by default**  
   In `.env` set `POWER_SAVE_MODE=true` and `INGEST_POWER_PROFILE=low-power` so the backend stays in low-power even when you start it without the battery script. Keep defaults in `.env.example` as `false` / `nominal` for CI and full-capability runs.
3. **Avoid heavy processes when not needed:** Do not start the orchestrator or MLX unless you need them; both add CPU (and MLX adds GPU) load.

**References:** Cadences and env knobs are in [backend/worker/ingest-loop.ts](backend/worker/ingest-loop.ts) (NOMINAL vs LOW_POWER + charging-flow adaptation), [src/lib/power/polling.ts](src/lib/power/polling.ts) (adaptive polling), and [.env.example](.env.example) (`VITE_POWER_PROFILE`, `VITE_POLL_INTERVAL_MULTIPLIER`, `POWER_SAVE_MODE`, `INGEST_POWER_PROFILE`).

### Recommended for charge stalls (~40%)

When the laptop is around 40% and charging slowly/stalling, use:

- `INGEST_CHARGING_FLOW_MODE=recharge-first`
- `VITE_BATTERY_DRAIN_MODE=recharge-first`
- `ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT=50`

`npm run dev:battery` and `npm run dev:battery:full` now apply this profile by default.

### Power drain audit

Run a granular power-drain audit with `npm run audit:power`. This runs the backend cadence test (setInterval >= 1000 ms), records power-related env, and scans backend/frontend for setInterval/setTimeout usage. Record results to JSON with `npm run audit:power:record` (writes `reports/progress/power-drain-audit.latest.json`).

The full E2E sweep (`npm run test:sweep`) runs the power drain audit as part of Phase 0. When battery is below `min_safe_battery_percent` or the execution profile is low-power, the sweep also skips Backend/AI granular, Full-stack mission, and Playwright to reduce drain (power-saver mode). See [POWER_DRAIN_AUDIT.md](POWER_DRAIN_AUDIT.md) for details and how to fix cadence violations.

## Telegram bot wiring

The **orchestrator** (Rust) is what talks to Telegram. It reads:

- `ORCHESTRATOR_TELEGRAM_BOT_TOKEN`
- `ORCHESTRATOR_TELEGRAM_CHAT_ID`

When you run the orchestrator via **`npm run dev:orchestrator`** (which runs `scripts/process/run-orchestrator.sh`), the script:

1. Sources the repo root **`.env`** if it exists.
2. If `ORCHESTRATOR_TELEGRAM_BOT_TOKEN` is unset but **`TELEGRAM_BOT_TOKEN`** is set in `.env`, it exports the latter as `ORCHESTRATOR_TELEGRAM_BOT_TOKEN`.
3. Same for **`TELEGRAM_CHAT_ID`** → `ORCHESTRATOR_TELEGRAM_CHAT_ID`.

So you can set **only** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your root `.env`; the script will pass them through to the orchestrator.

**To get the bot working:**

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Get your chat ID (e.g. send a message to the bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`).
3. In the repo root **`.env`** set:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdef...
   TELEGRAM_CHAT_ID=987654321
   ```
4. Build and run the orchestrator:
   ```bash
   cd gauss-orchestrator && cargo build --release && cd .. && npm run dev:orchestrator
   ```
   You should see in the logs: `telegram listener enabled`.

If you run the orchestrator binary **directly** (not via `npm run dev:orchestrator`), set `ORCHESTRATOR_TELEGRAM_BOT_TOKEN` and `ORCHESTRATOR_TELEGRAM_CHAT_ID` in the environment yourself, or run from a shell that has sourced `.env` and the script’s exports.
