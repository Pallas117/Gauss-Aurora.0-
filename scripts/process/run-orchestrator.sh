#!/usr/bin/env bash
set -euo pipefail

# Prefer current directory as workspace when it has gauss-orchestrator (e.g. "Gauss Aurora V0.1"),
# so we run this workspace's binary and load its .env instead of the parent repo's.
CWD="$(pwd)"
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -d "${CWD}/gauss-orchestrator" ]]; then
  ROOT="${CWD}"
else
  ROOT="${GIT_ROOT}"
fi
MODE="run"
OPTIONAL=0
echo "[orchestrator] ROOT=${ROOT}"

# Load .env: from workspace (ROOT) first, then git root if different and no .env in ROOT
ENV_FILE="${ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]] && [[ -n "${GIT_ROOT}" ]] && [[ "${ROOT}" != "${GIT_ROOT}" ]] && [[ -f "${GIT_ROOT}/.env" ]]; then
  ENV_FILE="${GIT_ROOT}/.env"
fi
if [[ -f "${ENV_FILE}" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" ]] && continue
    if [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*=(.*)$ ]]; then
      key="${line%%=*}"
      val="${line#*=}"
      val="${val#"${val%%[![:space:]]*}"}"
      export "${key}=${val}"
    fi
  done < "${ROOT}/.env"
fi
# Wire Telegram: if orchestrator vars are unset, use root .env Telegram vars
if [[ -z "${ORCHESTRATOR_TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  export ORCHESTRATOR_TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
fi
if [[ -z "${ORCHESTRATOR_TELEGRAM_CHAT_ID:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  export ORCHESTRATOR_TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID}"
fi
if [[ -n "${ORCHESTRATOR_TELEGRAM_BOT_TOKEN:-}" && -n "${ORCHESTRATOR_TELEGRAM_CHAT_ID:-}" ]]; then
  echo "[orchestrator] Telegram wired (ORCHESTRATOR_TELEGRAM_* or TELEGRAM_* from .env)"
fi
# #region agent log
DEBUG_LOG="${ROOT}/debug-21c0ed.log"
export DEBUG_LOG_PATH="${DEBUG_LOG}"
ht=0; hc=0; [[ -n "${ORCHESTRATOR_TELEGRAM_BOT_TOKEN:-}" ]] && ht=1; [[ -n "${ORCHESTRATOR_TELEGRAM_CHAT_ID:-}" ]] && hc=1
printf '%s\n' "{\"sessionId\":\"21c0ed\",\"hypothesisId\":\"H1\",\"location\":\"run-orchestrator.sh\",\"message\":\"Telegram env\",\"data\":{\"ROOT\":\"${ROOT}\",\"has_orch_token\":${ht},\"has_orch_chat_id\":${hc},\"ORCHESTRATOR_TELEGRAM_CHAT_ID\":\"${ORCHESTRATOR_TELEGRAM_CHAT_ID:-}\"},\"timestamp\":$(date +%s)000}" >> "${DEBUG_LOG}" 2>/dev/null || true
# #endregion

DO_BUILD=0
for arg in "$@"; do
  case "${arg}" in
    --check)
      MODE="check"
      ;;
    --optional)
      OPTIONAL=1
      ;;
    --build)
      DO_BUILD=1
      ;;
    *)
      echo "[orchestrator] unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

if [[ "${DO_BUILD}" -eq 1 ]] && [[ -d "${ROOT}/gauss-orchestrator" ]]; then
  echo "[orchestrator] building release binary..."
  (cd "${ROOT}/gauss-orchestrator" && cargo build --release) || exit 1
fi

declare -a CANDIDATES=(
  "${ROOT}/target/release/gauss-orchestrator"
  "${ROOT}/gauss-orchestrator/target/release/gauss-orchestrator"
)

for bin in "${CANDIDATES[@]}"; do
  if [[ -x "${bin}" ]]; then
    if [[ "${MODE}" == "check" ]]; then
      echo "${bin}"
      exit 0
    fi
    decode_flag="${ORCHESTRATOR_DECODE_ENABLED:-false}"
    xtce_path="${ORCHESTRATOR_XTCE_PATH:-./gauss-orchestrator/config/xtce/baseline.xtce.xml}"
    apid_map_path="${ORCHESTRATOR_APID_MAP_PATH:-./gauss-orchestrator/config/xtce/apid-map.json}"
    ingest_api_url="${ORCHESTRATOR_INGEST_API_URL:-http://127.0.0.1:3001/api/ingest/telemetry/packets}"
    echo "[orchestrator] starting ${bin}"
    echo "[orchestrator] decode_enabled=${decode_flag}"
    decode_lower="$(printf '%s' "${decode_flag}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${decode_lower}" == "true" || "${decode_flag}" == "1" ]]; then
      echo "[orchestrator] xtce=${xtce_path}"
      echo "[orchestrator] apid_map=${apid_map_path}"
      echo "[orchestrator] ingest_api=${ingest_api_url}"
    fi
    # Ensure telemetry watch dir exists so the binary does not error (use absolute path when unset)
    telemetry_dir="${ORCHESTRATOR_TELEMETRY_DIR:-}"
    if [[ -z "${telemetry_dir}" ]]; then
      telemetry_dir="${ROOT}/new_telemetry"
      export ORCHESTRATOR_TELEMETRY_DIR="${telemetry_dir}"
    fi
    mkdir -p "${telemetry_dir}"
    exec "${bin}"
  fi
done

echo "[orchestrator] binary not found." >&2
echo "[orchestrator] build with: (cd \"${ROOT}/gauss-orchestrator\" && cargo build --release)" >&2

if [[ "${OPTIONAL}" == "1" ]]; then
  exit 0
fi
exit 1
