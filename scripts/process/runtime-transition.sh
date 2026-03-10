#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

MODE="auto"
APPLY=false
VERIFY=false
QUIET=false

usage() {
  cat <<'EOF'
Usage:
  bash scripts/process/runtime-transition.sh [options]

Modes:
  auto               Prefer offload-supabase when cloud config is present, else smooth-powerdown.
  offload-supabase   Shift API dependency to cloud/Supabase path and stop local backend/orchestrator.
  smooth-powerdown   Enter low-power profile and gracefully stop local backend/orchestrator.

Options:
  --mode <name>      auto | offload-supabase | smooth-powerdown
  --apply            Execute process stops. Without this, script is dry-run.
  --verify           Run additional checks (Supabase RLS smoke for offload; power audit for powerdown).
  -q, --quiet        Reduce non-essential log output.
  -h, --help         Show this help message.
EOF
}

log() {
  local level="$1"
  shift
  if [[ "${QUIET}" == "true" && "${level}" == "INFO" ]]; then
    return 0
  fi
  printf '[%s] %s\n' "${level}" "$*"
}

load_env_file() {
  local file="${1:-}"
  [[ -f "${file}" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue

    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "${line}" =~ ^export[[:space:]]+ ]]; then
      line="${line#export }"
      line="${line#"${line%%[![:space:]]*}"}"
    fi

    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${value#"${value%%[![:space:]]*}"}"

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:-1}"
    fi

    printf -v "${key}" '%s' "${value}"
    export "${key}"
  done < "${file}"
}

is_placeholder_supabase_url() {
  local url="${1:-}"
  [[ -z "${url}" ]] && return 0
  [[ "${url}" == *"your-project.supabase.co"* ]] && return 0
  [[ "${url}" == *".example.com"* ]] && return 0
  return 1
}

is_supabase_configured() {
  local sb_url sb_service sb_anon
  sb_url="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
  sb_service="${SUPABASE_SERVICE_ROLE_KEY:-}"
  sb_anon="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}"
  if is_placeholder_supabase_url "${sb_url}"; then
    return 1
  fi
  [[ -n "${sb_url}" && -n "${sb_service}" && -n "${sb_anon}" ]]
}

is_loopback_url() {
  local url="${1:-}"
  [[ -z "${url}" ]] && return 1
  local lowered
  lowered="$(printf '%s' "${url}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" == *"localhost"* ]] && return 0
  [[ "${lowered}" == *"127.0.0.1"* ]] && return 0
  [[ "${lowered}" == *"[::1]"* ]] && return 0
  [[ "${lowered}" == *"::1"* ]] && return 0
  return 1
}

is_cloud_api_configured() {
  local cloud_api
  cloud_api="${GAUSS_CLOUD_API_BASE_URL:-${VITE_HELIO_PROXY_URL:-}}"
  [[ -n "${cloud_api}" ]] || return 1
  if is_loopback_url "${cloud_api}"; then
    return 1
  fi
  return 0
}

resolve_backend_base_url() {
  local base host port
  base="${BACKEND_BASE_URL:-}"
  if [[ -n "${base}" ]]; then
    printf '%s\n' "${base%/}"
    return 0
  fi

  host="${PROXY_HOST:-127.0.0.1}"
  port="${PROXY_PORT:-3001}"
  if [[ "${host}" == "0.0.0.0" || "${host}" == "::" || "${host}" == "[::]" ]]; then
    host="127.0.0.1"
  fi
  printf 'http://%s:%s\n' "${host}" "${port}"
}

resolve_runtime_api_mode() {
  local resolved_mode="${1:-}"
  case "${resolved_mode}" in
    offload-supabase)
      printf 'offloaded\n'
      ;;
    smooth-powerdown)
      printf 'suspended\n'
      ;;
    *)
      printf 'active\n'
      ;;
  esac
}

build_runtime_auth_args() {
  RUNTIME_AUTH_MODE="none"
  RUNTIME_AUTH_ARGS=()

  if [[ -n "${ORCHESTRATOR_INGEST_API_TOKEN:-}" ]]; then
    RUNTIME_AUTH_MODE="service-token"
    RUNTIME_AUTH_ARGS=(-H "x-gauss-service-token: ${ORCHESTRATOR_INGEST_API_TOKEN}")
    return 0
  fi

  if [[ -n "${BACKEND_AUTH_TOKEN:-}" ]]; then
    RUNTIME_AUTH_MODE="bearer"
    RUNTIME_AUTH_ARGS=(-H "Authorization: Bearer ${BACKEND_AUTH_TOKEN}")
    return 0
  fi
}

request_runtime_transition() {
  local runtime_mode="${1:-}"
  local resolved_mode="${2:-}"
  local base_url http_code response_file response_preview

  base_url="$(resolve_backend_base_url)"
  build_runtime_auth_args

  if [[ "${APPLY}" != "true" ]]; then
    log INFO "Dry-run: would request backend runtime mode '${runtime_mode}' via ${base_url}/api/ops/runtime/mode (auth=${RUNTIME_AUTH_MODE})."
    return 0
  fi

  response_file="$(mktemp)"
  http_code="$(
    curl -sS \
      --connect-timeout 2 \
      --max-time 5 \
      -o "${response_file}" \
      -w '%{http_code}' \
      -X POST \
      -H 'Content-Type: application/json' \
      "${RUNTIME_AUTH_ARGS[@]}" \
      --data "{\"mode\":\"${runtime_mode}\",\"source\":\"runtime-transition:${resolved_mode}\"}" \
      "${base_url}/api/ops/runtime/mode" \
    || true
  )"

  if [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
    rm -f "${response_file}"
    log WARN "Backend runtime API was not reachable at ${base_url}; falling back to process stop only."
    return 1
  fi

  response_preview="$(tr '\n' ' ' < "${response_file}" | cut -c 1-240)"
  rm -f "${response_file}"

  if [[ "${http_code}" =~ ^2[0-9][0-9]$ ]]; then
    log INFO "Backend runtime mode set to ${runtime_mode} via ${base_url} (auth=${RUNTIME_AUTH_MODE})."
    return 0
  fi

  if [[ "${http_code}" == "401" || "${http_code}" == "403" ]]; then
    log WARN "Backend runtime API rejected auth (HTTP ${http_code}). Set ORCHESTRATOR_INGEST_API_TOKEN or BACKEND_AUTH_TOKEN. Response: ${response_preview}"
    return 1
  fi

  log WARN "Backend runtime API returned HTTP ${http_code}. Response: ${response_preview}"
  return 1
}

collect_service_pids() {
  local ports=(3001 8089 8091)
  local p
  for p in "${ports[@]}"; do
    lsof -ti tcp:"${p}" -sTCP:LISTEN 2>/dev/null || true
  done | sort -u
}

stop_local_services() {
  local pids
  pids="$(collect_service_pids)"
  if [[ -z "${pids}" ]]; then
    log INFO "No backend/orchestrator listeners found on 3001/8089/8091."
    return 0
  fi

  if [[ "${APPLY}" != "true" ]]; then
    log WARN "Dry-run: would stop local service PIDs: ${pids//$'\n'/ }"
    return 0
  fi

  log INFO "Stopping local service PIDs: ${pids//$'\n'/ }"
  # shellcheck disable=SC2086
  kill -TERM ${pids} 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -KILL ${pids} 2>/dev/null || true

  local remaining
  remaining="$(collect_service_pids)"
  if [[ -n "${remaining}" ]]; then
    log WARN "Some service listeners remain active: ${remaining//$'\n'/ }"
    return 1
  fi

  log INFO "Local backend/orchestrator services stopped."
  return 0
}

print_offload_plan() {
  local cloud_api
  cloud_api="${GAUSS_CLOUD_API_BASE_URL:-${VITE_HELIO_PROXY_URL:-}}"
  cat <<EOF
Offload-to-cloud profile:
  GAUSS_AIR_GAP=false
  POWER_SAVE_MODE=true
  INGEST_POWER_PROFILE=low-power
  INGEST_ADAPTIVE_CHARGING_FLOW=true
  INGEST_CHARGING_FLOW_MODE=recharge-first
  VITE_POWER_PROFILE=low-power
  VITE_HELIO_WS_ENABLED=false
  VITE_HELIO_PROXY_URL=${cloud_api}
  Backend runtime target=offloaded

Frontend command (cloud API):
  VITE_HELIO_PROXY_URL="${cloud_api}" VITE_POWER_PROFILE=low-power VITE_HELIO_WS_ENABLED=false npm run dev
EOF
}

print_powerdown_plan() {
  cat <<'EOF'
Smooth-powerdown profile:
  GAUSS_AIR_GAP=true
  POWER_SAVE_MODE=true
  INGEST_POWER_PROFILE=low-power
  INGEST_ADAPTIVE_CHARGING_FLOW=true
  INGEST_CHARGING_FLOW_MODE=recharge-first
  ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT=50
  VITE_POWER_PROFILE=low-power
  VITE_HELIO_WS_ENABLED=false
  Backend runtime target=suspended

Restart command (battery-safe local):
  npm run dev:battery
EOF
}

run_optional_checks() {
  local resolved_mode="$1"
  if [[ "${VERIFY}" != "true" ]]; then
    return 0
  fi

  if [[ "${resolved_mode}" == "offload-supabase" ]]; then
    log INFO "Running Supabase RLS smoke test..."
    if ! (cd "${ROOT_DIR}" && npm run -s test:supabase-rls); then
      log WARN "Supabase RLS smoke did not pass. Offload config may be incomplete."
      return 1
    fi
    return 0
  fi

  log INFO "Running power drain audit..."
  if ! (cd "${ROOT_DIR}" && npm run -s audit:power); then
    log WARN "Power audit reported a failure."
    return 1
  fi
  return 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        MODE="${2:-}"
        shift 2
        ;;
      --apply)
        APPLY=true
        shift
        ;;
      --verify)
        VERIFY=true
        shift
        ;;
      -q|--quiet)
        QUIET=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 2
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  load_env_file "${ENV_FILE}"

  case "${MODE}" in
    auto|offload-supabase|smooth-powerdown) ;;
    *)
      echo "Invalid --mode '${MODE}'. Use auto|offload-supabase|smooth-powerdown." >&2
      exit 2
      ;;
  esac

  local supabase_ok cloud_api_ok resolved_mode runtime_status=0 stop_status=0 check_status=0 runtime_mode
  supabase_ok=false
  cloud_api_ok=false
  if is_supabase_configured; then supabase_ok=true; fi
  if is_cloud_api_configured; then cloud_api_ok=true; fi

  resolved_mode="${MODE}"
  if [[ "${MODE}" == "auto" ]]; then
    if [[ "${supabase_ok}" == "true" && "${cloud_api_ok}" == "true" ]]; then
      resolved_mode="offload-supabase"
    else
      resolved_mode="smooth-powerdown"
    fi
  fi

  log INFO "runtime-transition mode=${MODE} resolved=${resolved_mode} apply=${APPLY} verify=${VERIFY}"
  log INFO "supabase_configured=${supabase_ok} cloud_api_configured=${cloud_api_ok}"

  if [[ "${resolved_mode}" == "offload-supabase" ]]; then
    if [[ "${supabase_ok}" != "true" ]]; then
      log WARN "Supabase credentials are incomplete. Falling back to smooth-powerdown."
      resolved_mode="smooth-powerdown"
    elif [[ "${cloud_api_ok}" != "true" ]]; then
      log WARN "GAUSS_CLOUD_API_BASE_URL/VITE_HELIO_PROXY_URL is missing or loopback-local. Falling back to smooth-powerdown."
      resolved_mode="smooth-powerdown"
    fi
  fi

  if [[ "${resolved_mode}" == "offload-supabase" ]]; then
    print_offload_plan
  else
    print_powerdown_plan
  fi

  runtime_mode="$(resolve_runtime_api_mode "${resolved_mode}")"
  if ! request_runtime_transition "${runtime_mode}" "${resolved_mode}"; then
    runtime_status=1
  fi

  if ! run_optional_checks "${resolved_mode}"; then
    check_status=1
  fi

  if ! stop_local_services; then
    stop_status=1
  fi

  if [[ "${APPLY}" == "true" && "${stop_status}" -ne 0 ]]; then
    log WARN "Process stop was partial; you may need elevated permissions to terminate listeners."
  fi

  if [[ "${runtime_status}" -ne 0 ]]; then
    log WARN "Runtime transition API did not complete cleanly."
  fi

  if [[ "${check_status}" -ne 0 ]]; then
    log WARN "Verification checks reported issues."
  fi

  if [[ "${stop_status}" -ne 0 || "${check_status}" -ne 0 ]]; then
    exit 1
  fi
}

main "$@"
