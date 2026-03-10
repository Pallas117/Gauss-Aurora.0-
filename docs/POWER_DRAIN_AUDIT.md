# Power drain audit

The power-drain audit checks that the stack respects the Project Gauss power directive: no high-frequency polling, and consistent use of power profile and battery awareness.

## What it checks

1. **Backend cadence:** All `setInterval` calls in `backend/**/*.ts` use a literal interval >= 1000 ms (enforced by [backend/power-polling.test.ts](../backend/power-polling.test.ts)). Any violation fails the audit.
2. **Env snapshot:** Records `POWER_SAVE_MODE`, `INGEST_POWER_PROFILE`, `VITE_POWER_PROFILE`, `VITE_POLL_INTERVAL_MULTIPLIER`, and `BATTERY_PERCENT` (or unknown).
3. **Work queue:** Reads `min_safe_battery_percent` from `reports/orchestrator/work-queue.json` if present.
4. **Backend/frontend intervals (advisory):** Lists all `setInterval` and `setTimeout` calls with literal ms in backend and in `src/`. Frontend list is informational; frontend polling hooks should use [getAdaptivePollInterval](../src/lib/power/polling.ts) so they back off when battery is low or profile is low-power.

## How to run

- **Standalone:** `npm run audit:power`
- **Record to JSON:** `npm run audit:power:record` (writes `reports/progress/power-drain-audit.latest.json`)
- **As part of sweep:** The test orchestrator runs the power audit during the full E2E sweep (`npm run test:sweep`) after Phase 0.

## Fixing backend cadence violations

If the audit fails with "Backend cadence (setInterval >= 1000ms): FAIL":

1. Run `npm run test` and open `backend/power-polling.test.ts`; the test output lists file and line for each violation.
2. Either increase the interval to >= 1000 ms or add an `ALLOW_LOW_CADENCE` comment on the same or next line with a short reason (use sparingly).
3. Re-run `npm run audit:power` to confirm pass.

## Power-saver sweep

When battery is below `min_safe_battery_percent` (from work-queue, default 25) or the orchestrator profile is low-power (e.g. `POWER_SAVE_MODE=true` or &lt; 4 GB free RAM), the full sweep skips:

- Backend/AI granular
- Full-stack mission
- Playwright UI E2E

So the sweep still runs Phase 0, power drain audit, Rust orchestrator tests, backend unit tests, and optionally BXR E2E—reducing drain while keeping core checks.

### Charging-aware battery floor

- The sweep/audit/backprop battery guard is charging-aware.
- If the battery is **discharging**, the effective floor is raised to `max(min_safe_battery_percent, ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT)`.
- Default discharging floor is **45%** (override with `ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT`).
- You can override state in CI/debug with `BATTERY_PERCENT`, `BATTERY_CHARGING`, and `BATTERY_POWER_SOURCE`.

## Frontend polling

Data-fetching hooks should use `getAdaptivePollInterval(baseMs)` for their refresh interval so that:

- Low-power profile (`VITE_POWER_PROFILE=low-power`) increases the interval.
- Battery below 25% and discharging increases the interval.
- Tab hidden or `navigator.connection.saveData` increases the interval.

See [src/lib/power/polling.ts](../src/lib/power/polling.ts) and [BATTERY_AND_TELEGRAM.md](BATTERY_AND_TELEGRAM.md).

## Runtime charging-flow adaptation

- Ingestion runtime (`backend/worker/ingest-loop.ts`) applies charging-flow adaptive cadence on top of nominal/low-power profiles.
- Discharging battery increases cadence backoff; charging under 50% keeps a mild backoff to improve net recharge.
- Charging-flow modes:
  - `recharge-first`: most conservative, prioritizes net battery recovery
  - `balanced`: default compromise
  - `performance`: least conservative
- Knobs:
  - `INGEST_ADAPTIVE_CHARGING_FLOW=true|false` (default `true`)
  - `INGEST_POWER_FLOW_SAMPLE_MS` (default `60000`)
  - `INGEST_CHARGING_FLOW_MODE=recharge-first|balanced|performance`
  - `VITE_BATTERY_DRAIN_MODE=recharge-first|balanced|performance`
  - `BATTERY_PERCENT`, `BATTERY_CHARGING`, `BATTERY_POWER_SOURCE` (override for CI/debug)
