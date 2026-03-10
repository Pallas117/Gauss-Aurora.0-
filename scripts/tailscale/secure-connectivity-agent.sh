#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ASK_PERMISSION_SCRIPT="${ROOT_DIR}/scripts/telegram/ask-permission.sh"
REPORT_DIR="${ROOT_DIR}/reports/network"
FEED_FILE="${REPORT_DIR}/connectivity-feed.jsonl"
LATEST_FILE="${REPORT_DIR}/connectivity-latest.json"
OFFSET_FILE="${REPORT_DIR}/telegram-offset.txt"

MODE="once"
INTERVAL_SECS="${GAUSS_NETWORK_INTERVAL_SECS:-90}"
APPLY_CHANGES=false
REQUIRE_APPROVAL=true
QUIET=false
JSON_STDOUT=false
DRY_RUN=false

PROBE_URL="${GAUSS_CONNECTIVITY_PROBE_URL:-https://www.gstatic.com/generate_204}"
APPROVAL_TIMEOUT_SECS="${GAUSS_NETWORK_APPROVAL_TIMEOUT_SECS:-180}"
AUTO_APPROVE="${GAUSS_NETWORK_AUTO_APPROVE:-false}"
BYPASS_APPROVAL="${GAUSS_NETWORK_BYPASS_APPROVAL:-false}"

PRIMARY_SSID=""
PRIMARY_PASSWORD=""
SECONDARY_SSID=""
SECONDARY_PASSWORD=""
PRIMARY_SERVICE=""
SECONDARY_SERVICE=""

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

load_runtime_settings() {
  PRIMARY_SSID="${GAUSS_PRIMARY_HOTSPOT_SSID:-}"
  PRIMARY_PASSWORD="${GAUSS_PRIMARY_HOTSPOT_PASSWORD:-}"
  SECONDARY_SSID="${GAUSS_SECONDARY_WIFI_SSID:-}"
  SECONDARY_PASSWORD="${GAUSS_SECONDARY_WIFI_PASSWORD:-}"
  PRIMARY_SERVICE="${GAUSS_PRIMARY_NETWORK_SERVICE:-}"
  SECONDARY_SERVICE="${GAUSS_SECONDARY_NETWORK_SERVICE:-}"
  PROBE_URL="${GAUSS_CONNECTIVITY_PROBE_URL:-https://www.gstatic.com/generate_204}"
  APPROVAL_TIMEOUT_SECS="${GAUSS_NETWORK_APPROVAL_TIMEOUT_SECS:-180}"
  AUTO_APPROVE="${GAUSS_NETWORK_AUTO_APPROVE:-false}"
  BYPASS_APPROVAL="${GAUSS_NETWORK_BYPASS_APPROVAL:-false}"
}

usage() {
  cat <<'EOF'
Usage:
  bash scripts/tailscale/secure-connectivity-agent.sh [options]

Options:
      --once               Run one cycle (default).
      --loop               Run continuously.
      --interval <secs>    Loop interval in seconds (default: 90).
      --apply              Apply service order and Wi-Fi switching.
      --dry-run            Show planned actions without changing network.
      --no-approval        Do not require Telegram approval before applying changes.
      --json               Print cycle result as JSON.
  -q, --quiet              Reduce console output.
  -h, --help               Show this help message.

Core env:
  GAUSS_PRIMARY_HOTSPOT_SSID
  GAUSS_PRIMARY_HOTSPOT_PASSWORD
  GAUSS_SECONDARY_WIFI_SSID
  GAUSS_SECONDARY_WIFI_PASSWORD
  GAUSS_PRIMARY_NETWORK_SERVICE
  GAUSS_SECONDARY_NETWORK_SERVICE
  GAUSS_NETWORK_AUTO_APPROVE=false|true
  GAUSS_NETWORK_BYPASS_APPROVAL=false|true
  GAUSS_NETWORK_APPROVAL_TIMEOUT_SECS=180

Telegram env (for approval prompts):
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID

Output feed:
  reports/network/connectivity-feed.jsonl
  reports/network/connectivity-latest.json
EOF
}

parse_bool() {
  local raw="${1:-}"
  local fallback="${2:-false}"
  if [[ -z "${raw}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi
  case "$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) printf 'true' ;;
    0|false|no|off|disabled) printf 'false' ;;
    *) printf '%s' "${fallback}" ;;
  esac
}

json_escape() {
  printf '%s' "${1:-}" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN{first=1} {if(!first) printf "\\n"; printf "%s", $0; first=0}'
}

log() {
  local level="$1"
  shift
  if [[ "${QUIET}" == "true" && "${level}" == "INFO" ]]; then
    return 0
  fi
  printf '[%s] %s\n' "${level}" "$*"
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

detect_wifi_device() {
  if ! command -v networksetup >/dev/null 2>&1; then
    return 1
  fi
  networksetup -listallhardwareports 2>/dev/null \
    | awk '
      $1=="Hardware" && $2=="Port:" {
        port=$0
        sub(/^Hardware Port: /, "", port)
      }
      $1=="Device:" && (port=="Wi-Fi" || port=="AirPort") {
        print $2
        exit
      }'
}

airport_tool() {
  printf '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
}

current_ssid() {
  local wifi_device="${1:-}"
  if [[ -z "${wifi_device}" ]]; then
    printf ''
    return 0
  fi
  local line
  line="$(networksetup -getairportnetwork "${wifi_device}" 2>/dev/null || true)"
  if [[ "${line}" == *": "* ]]; then
    printf '%s' "${line#*: }"
  else
    printf ''
  fi
}

scan_ssids() {
  local airport_bin
  airport_bin="$(airport_tool)"
  if [[ ! -x "${airport_bin}" ]]; then
    return 0
  fi
  "${airport_bin}" -s 2>/dev/null \
    | tail -n +2 \
    | awk '
      {
        bssid_col=0
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/) {
            bssid_col = i
            break
          }
        }
        if (bssid_col <= 1) {
          next
        }
        ssid = $1
        for (j = 2; j < bssid_col; j++) {
          ssid = ssid " " $j
        }
        print ssid
      }'
}

ssid_visible() {
  local target="${1:-}"
  local visible_list="${2:-}"
  if [[ -z "${target}" ]]; then
    return 1
  fi
  printf '%s\n' "${visible_list}" | grep -Fxq "${target}"
}

tailscale_state() {
  if ! command -v tailscale >/dev/null 2>&1; then
    printf 'unavailable'
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local state
    state="$(tailscale status --json 2>/dev/null | jq -r '.BackendState // "unknown"' 2>/dev/null || true)"
    if [[ -n "${state}" && "${state}" != "unknown" ]]; then
      printf '%s' "$(printf '%s' "${state}" | tr '[:upper:]' '[:lower:]')"
      return 0
    fi
  fi
  local text
  text="$(tailscale status 2>/dev/null || true)"
  if [[ "${text}" == *"Tailscale is stopped"* ]]; then
    printf 'stopped'
  elif [[ -n "${text}" ]]; then
    printf 'running'
  else
    printf 'unknown'
  fi
}

internet_probe() {
  curl -sS --max-time 5 "${PROBE_URL}" >/dev/null 2>&1
}

firewall_state() {
  local tool="/usr/libexec/ApplicationFirewall/socketfilterfw"
  if [[ ! -x "${tool}" ]]; then
    printf 'unknown'
    return 0
  fi
  local output
  output="$("${tool}" --getglobalstate 2>/dev/null || true)"
  if [[ "${output}" == *"enabled"* ]]; then
    printf 'enabled'
  elif [[ "${output}" == *"disabled"* ]]; then
    printf 'disabled'
  else
    printf 'unknown'
  fi
}

has_unsafe_allowed_origins() {
  local raw="${ALLOWED_ORIGINS:-}"
  [[ -z "${raw}" ]] && return 1

  local old_ifs="${IFS}"
  IFS=','
  for item in ${raw}; do
    local trimmed="${item#"${item%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [[ -z "${trimmed}" ]] && continue
    if [[ "${trimmed}" == *"*"* || "${trimmed}" =~ ^https?://0\.0\.0\.0(:[0-9]+)?$ ]]; then
      IFS="${old_ifs}"
      return 0
    fi
  done
  IFS="${old_ifs}"
  return 1
}

service_order_mismatch() {
  local primary="${1:-}"
  local secondary="${2:-}"
  if [[ -z "${primary}" || -z "${secondary}" ]]; then
    return 1
  fi
  local list
  list="$(networksetup -listnetworkserviceorder 2>/dev/null \
    | awk -F') ' '/^\([0-9]+\)/{print $2}' \
    | sed 's/^[*]//')"
  local p_idx s_idx idx=0
  p_idx=-1
  s_idx=-1
  while IFS= read -r service; do
    idx=$((idx + 1))
    if [[ "${service}" == "${primary}" ]]; then
      p_idx="${idx}"
    fi
    if [[ "${service}" == "${secondary}" ]]; then
      s_idx="${idx}"
    fi
  done <<< "${list}"
  if (( p_idx > 0 && s_idx > 0 && p_idx > s_idx )); then
    return 0
  fi
  return 1
}

apply_service_order() {
  local primary="${1:-}"
  local secondary="${2:-}"
  if [[ -z "${primary}" || -z "${secondary}" ]]; then
    return 0
  fi
  local services
  mapfile -t services < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | sed 's/^[*]//')
  if (( ${#services[@]} == 0 )); then
    return 1
  fi

  local ordered=()
  ordered+=("${primary}")
  ordered+=("${secondary}")
  for svc in "${services[@]}"; do
    if [[ "${svc}" == "${primary}" || "${svc}" == "${secondary}" ]]; then
      continue
    fi
    ordered+=("${svc}")
  done

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "INFO" "dry-run: would set service order: ${ordered[*]}"
    return 0
  fi
  networksetup -ordernetworkservices "${ordered[@]}" >/dev/null
}

switch_wifi() {
  local wifi_device="${1:-}"
  local ssid="${2:-}"
  local password="${3:-}"
  if [[ -z "${wifi_device}" || -z "${ssid}" ]]; then
    return 1
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "INFO" "dry-run: would switch Wi-Fi (${wifi_device}) to SSID '${ssid}'."
    return 0
  fi

  if [[ -n "${password}" ]]; then
    networksetup -setairportnetwork "${wifi_device}" "${ssid}" "${password}" >/dev/null
  else
    networksetup -setairportnetwork "${wifi_device}" "${ssid}" >/dev/null
  fi
}

poll_telegram_approval() {
  local request_id="${1:-}"
  local timeout_secs="${2:-180}"
  local token="${TELEGRAM_BOT_TOKEN:-}"
  local chat_id="${TELEGRAM_CHAT_ID:-}"

  if [[ -z "${token}" || -z "${chat_id}" ]]; then
    printf 'missing_telegram_env'
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    printf 'jq_required_for_approval_poll'
    return 1
  fi

  mkdir -p "${REPORT_DIR}"
  local offset="0"
  if [[ -f "${OFFSET_FILE}" ]]; then
    offset="$(cat "${OFFSET_FILE}" 2>/dev/null || printf '0')"
  fi
  local deadline=$(( "$(date +%s)" + timeout_secs ))

  while (( "$(date +%s)" < deadline )); do
    local response
    response="$(curl -sS --max-time 30 \
      "https://api.telegram.org/bot${token}/getUpdates" \
      --data-urlencode "timeout=20" \
      --data-urlencode "offset=${offset}" || true)"
    local ok
    ok="$(printf '%s' "${response}" | jq -r '.ok // false' 2>/dev/null || printf 'false')"
    if [[ "${ok}" != "true" ]]; then
      sleep 3
      continue
    fi

    while IFS=$'\t' read -r update_id msg_chat msg_text; do
      [[ -z "${update_id}" || "${update_id}" == "null" ]] && continue
      offset=$((update_id + 1))
      printf '%s' "${offset}" > "${OFFSET_FILE}"

      if [[ "${msg_chat}" != "${chat_id}" ]]; then
        continue
      fi

      local text_lc
      text_lc="$(printf '%s' "${msg_text}" | tr '[:upper:]' '[:lower:]')"
      if [[ "${text_lc}" != *"${request_id}"* ]]; then
        continue
      fi

      if [[ "${text_lc}" =~ (^|[[:space:]])(/approve|approve|yes|allow|ok)([[:space:]]|$) ]]; then
        printf 'approved'
        return 0
      fi
      if [[ "${text_lc}" =~ (^|[[:space:]])(/deny|deny|no|reject|block)([[:space:]]|$) ]]; then
        printf 'denied'
        return 0
      fi
    done < <(printf '%s' "${response}" | jq -r '.result[] | [.update_id, (.message.chat.id // .edited_message.chat.id // ""), (.message.text // .edited_message.text // "")] | @tsv' 2>/dev/null || true)

    sleep 2
  done

  printf 'timeout'
  return 1
}

request_permission() {
  local action_detail="${1:-}"
  local request_id="net-$(date +%s)-${RANDOM}"

  if [[ "$(parse_bool "${BYPASS_APPROVAL}" false)" == "true" ]]; then
    printf 'approved'
    return 0
  fi
  if [[ "$(parse_bool "${REQUIRE_APPROVAL}" true)" != "true" ]]; then
    printf 'approved'
    return 0
  fi
  if [[ "$(parse_bool "${AUTO_APPROVE}" false)" == "true" ]]; then
    if [[ -x "${ASK_PERMISSION_SCRIPT}" ]]; then
      bash "${ASK_PERMISSION_SCRIPT}" --quiet --message \
        "Gauss network automation auto-approved. request_id=${request_id}. action=${action_detail}" || true
    fi
    printf 'approved'
    return 0
  fi
  if [[ ! -x "${ASK_PERMISSION_SCRIPT}" ]]; then
    printf 'ask_permission_script_missing'
    return 1
  fi

  local prompt="Gauss permission request (${request_id}): ${action_detail}. Reply '/approve ${request_id}' or '/deny ${request_id}'."
  if ! bash "${ASK_PERMISSION_SCRIPT}" --quiet --message "${prompt}" >/dev/null 2>&1; then
    printf 'telegram_send_failed'
    return 1
  fi
  poll_telegram_approval "${request_id}" "${APPROVAL_TIMEOUT_SECS}"
}

write_feed() {
  local payload="$1"
  mkdir -p "${REPORT_DIR}"
  printf '%s\n' "${payload}" >> "${FEED_FILE}"
  printf '%s\n' "${payload}" > "${LATEST_FILE}"
}

run_cycle() {
  load_runtime_settings

  local timestamp
  timestamp="$(now_utc)"

  local wifi_device
  wifi_device="$(detect_wifi_device || true)"
  local current
  current="$(current_ssid "${wifi_device}")"
  local visible
  visible="$(scan_ssids || true)"

  local primary_visible="false"
  local secondary_visible="false"
  if ssid_visible "${PRIMARY_SSID}" "${visible}"; then
    primary_visible="true"
  fi
  if ssid_visible "${SECONDARY_SSID}" "${visible}"; then
    secondary_visible="true"
  fi

  local tailscale
  tailscale="$(tailscale_state)"
  local internet_ok="false"
  if internet_probe; then
    internet_ok="true"
  fi
  local firewall
  firewall="$(firewall_state)"

  local auth_required
  auth_required="$(parse_bool "${AUTH_REQUIRED:-true}" true)"
  local cybertiger_enabled
  cybertiger_enabled="$(parse_bool "${CYBERTIGER_ENABLED:-true}" true)"
  local unsafe_origins="false"
  if has_unsafe_allowed_origins; then
    unsafe_origins="true"
  fi

  local security_score=0
  if [[ "${tailscale}" == "running" ]]; then security_score=$((security_score + 30)); fi
  if [[ "${auth_required}" == "true" ]]; then security_score=$((security_score + 20)); fi
  if [[ "${cybertiger_enabled}" == "true" ]]; then security_score=$((security_score + 20)); fi
  if [[ "${firewall}" == "enabled" ]]; then security_score=$((security_score + 20)); fi
  if [[ "${unsafe_origins}" == "false" ]]; then security_score=$((security_score + 10)); fi
  if (( security_score > 100 )); then security_score=100; fi

  local connectivity_score=0
  if [[ "${internet_ok}" == "true" ]]; then connectivity_score=$((connectivity_score + 40)); fi
  if [[ "${tailscale}" == "running" ]]; then connectivity_score=$((connectivity_score + 20)); fi
  if [[ -n "${PRIMARY_SSID}" && "${current}" == "${PRIMARY_SSID}" ]]; then
    connectivity_score=$((connectivity_score + 30))
  elif [[ -n "${SECONDARY_SSID}" && "${current}" == "${SECONDARY_SSID}" ]]; then
    connectivity_score=$((connectivity_score + 20))
  fi
  if [[ "${primary_visible}" == "true" ]]; then
    connectivity_score=$((connectivity_score + 10))
  elif [[ "${secondary_visible}" == "true" ]]; then
    connectivity_score=$((connectivity_score + 5))
  fi
  if (( connectivity_score > 100 )); then connectivity_score=100; fi

  local target_ssid=""
  local target_password=""
  if [[ -n "${PRIMARY_SSID}" && "${primary_visible}" == "true" ]]; then
    target_ssid="${PRIMARY_SSID}"
    target_password="${PRIMARY_PASSWORD}"
  elif [[ -n "${SECONDARY_SSID}" && "${secondary_visible}" == "true" ]]; then
    target_ssid="${SECONDARY_SSID}"
    target_password="${SECONDARY_PASSWORD}"
  fi

  local action="none"
  local approval="n/a"
  local result="no_change"
  local notes=()

  if [[ "${unsafe_origins}" == "true" ]]; then
    notes+=("unsafe ALLOWED_ORIGINS contains wildcard or 0.0.0.0")
  fi
  if [[ "${auth_required}" != "true" ]]; then
    notes+=("AUTH_REQUIRED is disabled")
  fi
  if [[ "${cybertiger_enabled}" != "true" ]]; then
    notes+=("CYBERTIGER_ENABLED is disabled")
  fi
  if [[ "${tailscale}" != "running" ]]; then
    notes+=("tailscale not running")
  fi
  if [[ "${firewall}" != "enabled" ]]; then
    notes+=("macOS application firewall not enabled")
  fi

  if [[ "${APPLY_CHANGES}" == "true" ]]; then
    if service_order_mismatch "${PRIMARY_SERVICE}" "${SECONDARY_SERVICE}"; then
      action="reorder_services"
      approval="$(request_permission "Reorder network services: '${PRIMARY_SERVICE}' before '${SECONDARY_SERVICE}'." || true)"
      if [[ "${approval}" == "approved" ]]; then
        if apply_service_order "${PRIMARY_SERVICE}" "${SECONDARY_SERVICE}"; then
          result="service_order_updated"
          notes+=("service order updated")
        else
          result="service_order_failed"
          notes+=("service order update failed")
        fi
      else
        result="service_order_skipped"
        notes+=("service order change not approved (${approval})")
      fi
    fi

    if [[ -n "${target_ssid}" && "${current}" != "${target_ssid}" ]]; then
      action="switch_wifi"
      approval="$(request_permission "Switch Wi-Fi from '${current:-<none>}' to '${target_ssid}' for secure connectivity." || true)"
      if [[ "${approval}" == "approved" ]]; then
        if switch_wifi "${wifi_device}" "${target_ssid}" "${target_password}"; then
          sleep 3
          result="switched_to_${target_ssid}"
          notes+=("switched Wi-Fi to ${target_ssid}")
          current="$(current_ssid "${wifi_device}")"
        else
          result="switch_failed"
          notes+=("failed to switch Wi-Fi to ${target_ssid}")
        fi
      else
        result="switch_skipped"
        notes+=("Wi-Fi switch not approved (${approval})")
      fi
    fi
  fi

  local notes_text=""
  if (( ${#notes[@]} > 0 )); then
    notes_text="$(IFS='; '; printf '%s' "${notes[*]}")"
  fi

  local payload
  payload="{\"timestamp\":\"$(json_escape "${timestamp}")\",\"security_score\":${security_score},\"connectivity_score\":${connectivity_score},\"tailscale_state\":\"$(json_escape "${tailscale}")\",\"firewall_state\":\"$(json_escape "${firewall}")\",\"internet_ok\":${internet_ok},\"current_ssid\":\"$(json_escape "${current}")\",\"target_ssid\":\"$(json_escape "${target_ssid}")\",\"primary_visible\":${primary_visible},\"secondary_visible\":${secondary_visible},\"action\":\"$(json_escape "${action}")\",\"result\":\"$(json_escape "${result}")\",\"approval\":\"$(json_escape "${approval}")\",\"notes\":\"$(json_escape "${notes_text}")\"}"

  write_feed "${payload}"

  if [[ "${JSON_STDOUT}" == "true" ]]; then
    printf '%s\n' "${payload}"
  else
    log "INFO" "timestamp=${timestamp}"
    log "INFO" "scores security=${security_score} connectivity=${connectivity_score}"
    log "INFO" "tailscale=${tailscale} firewall=${firewall} internet=${internet_ok} ssid='${current}' target='${target_ssid}'"
    if [[ -n "${notes_text}" ]]; then
      log "WARN" "${notes_text}"
    fi
    log "INFO" "result=${result} approval=${approval} feed=${FEED_FILE}"
  fi
}

load_env_file "${ENV_FILE}"

while (($# > 0)); do
  case "$1" in
    --once) MODE="once"; shift ;;
    --loop) MODE="loop"; shift ;;
    --interval)
      shift
      [[ $# -gt 0 ]] || { echo "Error: --interval requires a value." >&2; exit 1; }
      INTERVAL_SECS="$1"
      shift
      ;;
    --apply) APPLY_CHANGES=true; shift ;;
    --dry-run) DRY_RUN=true; APPLY_CHANGES=true; shift ;;
    --no-approval) REQUIRE_APPROVAL=false; shift ;;
    --json) JSON_STDOUT=true; shift ;;
    -q|--quiet) QUIET=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Error: unknown option '$1'" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$(parse_bool "${DRY_RUN}" false)" == "true" ]]; then
  REQUIRE_APPROVAL=false
fi

if [[ "${MODE}" == "once" ]]; then
  run_cycle
  exit 0
fi

log "INFO" "starting secure connectivity agent loop interval=${INTERVAL_SECS}s apply=${APPLY_CHANGES} require_approval=${REQUIRE_APPROVAL}"
while true; do
  run_cycle
  sleep "${INTERVAL_SECS}"
done
