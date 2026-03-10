#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "${ROOT}"

is_port_busy() {
  local port="${1:-}"
  [[ -n "${port}" ]] || return 1
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

# Sovereign/offline-safe demo defaults. Keep override-friendly for operator tweaks.
export GAUSS_AIR_GAP="${GAUSS_AIR_GAP:-true}"
export VITE_HELIO_WS_ENABLED="${VITE_HELIO_WS_ENABLED:-false}"
export VITE_POWER_PROFILE="${VITE_POWER_PROFILE:-low-power}"
export VITE_POLL_INTERVAL_MULTIPLIER="${VITE_POLL_INTERVAL_MULTIPLIER:-2}"
export VITE_BATTERY_DRAIN_MODE="${VITE_BATTERY_DRAIN_MODE:-recharge-first}"
export VITE_LANDING_SCENE_AUTOSTART="${VITE_LANDING_SCENE_AUTOSTART:-false}"
export POWER_SAVE_MODE="${POWER_SAVE_MODE:-true}"
export INGEST_POWER_PROFILE="${INGEST_POWER_PROFILE:-low-power}"
export INGEST_ADAPTIVE_CHARGING_FLOW="${INGEST_ADAPTIVE_CHARGING_FLOW:-true}"
export INGEST_CHARGING_FLOW_MODE="${INGEST_CHARGING_FLOW_MODE:-recharge-first}"
export ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT="${ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT:-50}"

# No MLX/local model dependency during demo: always route to stub engine.
export GAUSS_BRAIN_URL="${GAUSS_BRAIN_URL:-http://127.0.0.1:8089/v1}"
export ORCHESTRATOR_LOCAL_ENGINE_URL="${ORCHESTRATOR_LOCAL_ENGINE_URL:-http://127.0.0.1:8089/v1/chat/completions}"
export PROXY_PORT="${PROXY_PORT:-3001}"
export GAUSS_BRAIN_PORT="${GAUSS_BRAIN_PORT:-8089}"

echo "Investor demo profile:"
echo "  air_gap=${GAUSS_AIR_GAP}"
echo "  power_profile=${VITE_POWER_PROFILE}"
echo "  power_save=${POWER_SAVE_MODE}"
echo "  charging_mode=${INGEST_CHARGING_FLOW_MODE}"
echo "  model_backend=stub@${GAUSS_BRAIN_URL}"
echo "  frontend_port=8080 backend_port=${PROXY_PORT} brain_stub_port=${GAUSS_BRAIN_PORT}"
echo ""

if is_port_busy "8080" || is_port_busy "${PROXY_PORT}" || is_port_busy "${GAUSS_BRAIN_PORT}"; then
  echo "Cannot start demo profile because one or more required ports are already in use."
  echo "Required free ports: 8080, ${PROXY_PORT}, ${GAUSS_BRAIN_PORT}"
  echo "Run 'npm run dev:prune' to clear stale listeners, then retry."
  exit 1
fi

echo "Starting FE + API + brain-stub stack..."
exec npx concurrently -k -n FE,API,BRAIN -c cyan,green,magenta \
  "npm run dev" \
  "npm run dev:proxy" \
  "npm run dev:brain:stub"
