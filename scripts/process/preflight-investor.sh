#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "${ROOT}"

# Align audits/tests with locked investor demo profile by default.
export GAUSS_AIR_GAP="${GAUSS_AIR_GAP:-true}"
export VITE_HELIO_WS_ENABLED="${VITE_HELIO_WS_ENABLED:-false}"
export VITE_POWER_PROFILE="${VITE_POWER_PROFILE:-low-power}"
export VITE_POLL_INTERVAL_MULTIPLIER="${VITE_POLL_INTERVAL_MULTIPLIER:-2}"
export VITE_BATTERY_DRAIN_MODE="${VITE_BATTERY_DRAIN_MODE:-recharge-first}"
export POWER_SAVE_MODE="${POWER_SAVE_MODE:-true}"
export INGEST_POWER_PROFILE="${INGEST_POWER_PROFILE:-low-power}"
export INGEST_ADAPTIVE_CHARGING_FLOW="${INGEST_ADAPTIVE_CHARGING_FLOW:-true}"
export INGEST_CHARGING_FLOW_MODE="${INGEST_CHARGING_FLOW_MODE:-recharge-first}"
export ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT="${ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT:-50}"

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
  C_RESET=$'\033[0m'
else
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_CYAN=""
  C_RESET=""
fi

declare -a STEP_NAMES=()
declare -a STEP_RESULTS=()
declare -a STEP_DURATIONS=()
FAILURES=0

run_step() {
  local name="$1"
  shift

  local start_ts end_ts duration_s
  start_ts="$(date +%s)"
  printf "\n${C_CYAN}==> %s${C_RESET}\n" "${name}"

  if "$@"; then
    STEP_NAMES+=("${name}")
    STEP_RESULTS+=("PASS")
    end_ts="$(date +%s)"
    duration_s="$((end_ts - start_ts))s"
    STEP_DURATIONS+=("${duration_s}")
    printf "${C_GREEN}PASS${C_RESET} %s (%s)\n" "${name}" "${duration_s}"
    return 0
  fi

  STEP_NAMES+=("${name}")
  STEP_RESULTS+=("FAIL")
  end_ts="$(date +%s)"
  duration_s="$((end_ts - start_ts))s"
  STEP_DURATIONS+=("${duration_s}")
  FAILURES="$((FAILURES + 1))"
  printf "${C_RED}FAIL${C_RESET} %s (%s)\n" "${name}" "${duration_s}"
  return 0
}

echo "Investor preflight checks"
echo "Repository: ${ROOT}"
echo "Date: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "Profile: air_gap=${GAUSS_AIR_GAP}, power=${VITE_POWER_PROFILE}, charging=${INGEST_CHARGING_FLOW_MODE}"

run_step "TypeScript lint" npm run lint
run_step "Production build" npm run build
run_step "SDA + boot smoke (Playwright)" npm run test:ui:investor-smoke
run_step "Network management audit" env ORCHESTRATOR_PASS_API_ENABLED=false npm run check:network-management
run_step "Power drain audit" npm run audit:power

echo ""
echo "Preflight summary"
echo "-----------------"
for idx in "${!STEP_NAMES[@]}"; do
  step="${STEP_NAMES[$idx]}"
  result="${STEP_RESULTS[$idx]}"
  duration="${STEP_DURATIONS[$idx]}"
  if [[ "${result}" == "PASS" ]]; then
    printf "${C_GREEN}%-4s${C_RESET} %s (%s)\n" "${result}" "${step}" "${duration}"
  else
    printf "${C_RED}%-4s${C_RESET} %s (%s)\n" "${result}" "${step}" "${duration}"
  fi
done

if [[ "${FAILURES}" -gt 0 ]]; then
  echo ""
  printf "${C_RED}Preflight failed: %s step(s) failed.${C_RESET}\n" "${FAILURES}"
  exit 1
fi

echo ""
printf "${C_GREEN}Preflight passed: system is demo-ready.${C_RESET}\n"
