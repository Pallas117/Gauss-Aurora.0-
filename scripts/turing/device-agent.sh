#!/usr/bin/env bash
# Turing device agent: register this machine with the Gauss backend and send heartbeats.
# Run on any device on the Tailscale mesh (e.g. Dell XPS 9570) so the backend can distribute
# cache and compute work. No WireGuard conversion needed — Tailscale already uses WireGuard.
#
# Usage:
#   BACKEND_URL=https://100.x.y.z:3001 TURING_SECRET=xxx ./device-agent.sh
#   BACKEND_URL=http://localhost:3001 JOIN_CODE=ABC12XYZ ./device-agent.sh   # one-time code from web app (auto-approved)
#   BACKEND_URL=http://localhost:3001 HOSTNAME=dell-xps-9570 TURING_RAM_MB=16384 TURING_CAPABILITIES=cache,inference ./device-agent.sh
#
# Optional env:
#   BACKEND_URL              - Backend base URL (required)
#   JOIN_CODE                - One-time code from web app (Turing > Generate join code); device is auto-approved (no TURING_SECRET needed)
#   TURING_SECRET            - Same as TURING_REGISTER_SECRET on backend (if set; not required when using JOIN_CODE)
#   HOSTNAME                 - Device name (default: hostname -s)
#   TURING_RAM_MB           - RAM in MB (default: detect or 0)
#   TURING_CAPABILITIES      - Comma-separated: cache, inference, batch, compute (default: cache)
#   TURING_HEARTBEAT_SEC     - Heartbeat interval seconds (default: 60)
#   TURING_DEVICE_PORT       - Port this device serves cache/compute on (default: 8090) — for display only
#   TURING_BATTERY_PERCENT   - Override battery percent [0-100] when OS detection is unavailable
#   TURING_NETWORK_INVENTORY_ENABLED - Attach passive local network inventory (default: false)
#   TURING_NETWORK_INVENTORY_INTERVAL_SEC - Inventory refresh interval (default: 300)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_URL="${BACKEND_URL:-}"
JOIN_CODE="${JOIN_CODE:-}"
TURING_SECRET="${TURING_SECRET:-}"
HOSTNAME="${HOSTNAME:-$(hostname -s 2>/dev/null || echo "turing-device")}"
# Sanitize for JSON (no backslash or double-quote)
HOSTNAME="$(echo "${HOSTNAME}" | sed 's/["\\]/_/g')"
TURING_RAM_MB="${TURING_RAM_MB:-0}"
TURING_CAPABILITIES="${TURING_CAPABILITIES:-cache}"
TURING_HEARTBEAT_SEC="${TURING_HEARTBEAT_SEC:-60}"
TURING_DEVICE_PORT="${TURING_DEVICE_PORT:-8090}"
TURING_NETWORK_INVENTORY_ENABLED="${TURING_NETWORK_INVENTORY_ENABLED:-false}"
TURING_NETWORK_INVENTORY_INTERVAL_SEC="${TURING_NETWORK_INVENTORY_INTERVAL_SEC:-300}"
network_inventory_json=""
last_network_inventory_at=0

# Trim trailing slash
BACKEND_URL="${BACKEND_URL%/}"

if [[ -z "${BACKEND_URL}" ]]; then
  echo "ERROR: BACKEND_URL is required (e.g. https://100.x.y.z:3001 or http://localhost:3001)" >&2
  exit 1
fi

# Anti-botnet: either JOIN_CODE (one-time from web app) or TURING_SECRET required for registration
if [[ -z "${JOIN_CODE}" ]] && [[ -z "${TURING_SECRET}" ]]; then
  echo "ERROR: Set JOIN_CODE (from web app > Turing > Generate join code) or TURING_SECRET to register." >&2
  exit 1
fi

# Resolve Tailscale IPv4 (required for backend to reach this device)
get_tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    local ip
    ip="$(tailscale ip -4 2>/dev/null | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/{print; exit}')"
    if [[ -n "${ip}" ]]; then
      echo "${ip}"
      return
    fi
  fi
  # Fallback: try to find a 100.x CGNAT-style address on the host (common for Tailscale)
  if command -v ip >/dev/null 2>&1; then
    ip addr 2>/dev/null | awk '/inet 100\./[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/{print $2; exit}' | sed 's/\/.*//'
  fi
}

TAILSCALE_IP="$(get_tailscale_ip)"
if [[ -z "${TAILSCALE_IP}" ]]; then
  echo "ERROR: Could not get Tailscale IPv4. Install Tailscale and run 'tailscale up', or set TAILSCALE_IP manually." >&2
  exit 1
fi

# Optional: detect RAM on Linux
if [[ "${TURING_RAM_MB}" == "0" ]] && [[ -f /proc/meminfo ]]; then
  total_kb="$(awk '/MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
  if [[ -n "${total_kb}" ]]; then
    TURING_RAM_MB=$(( total_kb / 1024 ))
  fi
fi

# Build capabilities array JSON
cap_json="["
first=1
while IFS= read -r -d ',' cap; do
  cap="$(echo "${cap}" | tr -d ' ')";
  [[ -z "${cap}" ]] && continue
  [[ $first -eq 1 ]] && first=0 || cap_json+=","
  cap_json+="\"${cap}\""
done <<< "${TURING_CAPABILITIES},"
cap_json+="]"

# Build register payload; include join_code if set (one-time code from web app = auto-approved)
if [[ -n "${JOIN_CODE}" ]]; then
  join_trimmed="$(echo "${JOIN_CODE}" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  register_payload="{\"hostname\":\"${HOSTNAME}\",\"tailscale_ip\":\"${TAILSCALE_IP}\",\"ram_mb\":${TURING_RAM_MB},\"capabilities\":${cap_json},\"join_code\":\"${join_trimmed}\"}"
else
  register_payload="{\"hostname\":\"${HOSTNAME}\",\"tailscale_ip\":\"${TAILSCALE_IP}\",\"ram_mb\":${TURING_RAM_MB},\"capabilities\":${cap_json}}"
fi

curl_headers=(-H "Content-Type: application/json")
if [[ -n "${TURING_SECRET}" ]]; then
  curl_headers+=(-H "X-Turing-Secret: ${TURING_SECRET}")
fi

echo "[turing-agent] hostname=${HOSTNAME} tailscale_ip=${TAILSCALE_IP} ram_mb=${TURING_RAM_MB} capabilities=${TURING_CAPABILITIES}"
echo "[turing-agent] Registering with ${BACKEND_URL}/api/turing/register ..."

res="$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/api/turing/register" \
  "${curl_headers[@]}" \
  -d "${register_payload}")"
http_code="$(echo "${res}" | tail -n1)"
body="$(echo "${res}" | sed '$d')"

if [[ "${http_code}" != "201" ]]; then
  echo "[turing-agent] Register failed HTTP ${http_code}: ${body}" >&2
  exit 1
fi

device_id="$(echo "${body}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
if [[ -z "${device_id}" ]]; then
  device_id="unknown"
fi
echo "[turing-agent] Registered device_id=${device_id}"

# Collect device health for heartbeat (RAM used MB, load average, battery). Used for health display and selection.
collect_health() {
  local ram_used_mb=""
  local load_val=""
  local battery_pct=""
  local charging_state=""
  local power_source=""
  if [[ -f /proc/meminfo ]]; then
    local mem_total mem_avail
    mem_total="$(awk '/MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
    mem_avail="$(awk '/MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"
    if [[ -n "${mem_total}" ]] && [[ -n "${mem_avail}" ]]; then
      ram_used_mb=$(( (mem_total - mem_avail) / 1024 ))
    fi
  fi
  if [[ -f /proc/loadavg ]]; then
    load_val="$(awk '{print $1}' /proc/loadavg 2>/dev/null)"
  fi
  # Battery percent: prefer explicit override, then OS detection
  if [[ -n "${TURING_BATTERY_PERCENT:-}" ]] && [[ "${TURING_BATTERY_PERCENT}" =~ ^[0-9]+$ ]]; then
    battery_pct="${TURING_BATTERY_PERCENT}"
  else
    if command -v pmset >/dev/null 2>&1; then
      local batt_raw
      batt_raw="$(pmset -g batt 2>/dev/null || true)"
      battery_pct="$(printf '%s\n' "${batt_raw}" | grep -Eo '[0-9]+%' | head -1 | tr -d '%')"
      if printf '%s\n' "${batt_raw}" | grep -qi "AC Power"; then
        power_source="ac"
      elif printf '%s\n' "${batt_raw}" | grep -qi "Battery Power"; then
        power_source="battery"
      fi
      if printf '%s\n' "${batt_raw}" | grep -qi "charging"; then
        charging_state="true"
      elif printf '%s\n' "${batt_raw}" | grep -qi "discharging"; then
        charging_state="false"
      fi
    elif [[ -d /sys/class/power_supply ]]; then
      # Linux laptops: use first BAT* capacity file
      local cap_file
      cap_file="$(ls /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1 || true)"
      if [[ -n "${cap_file}" ]] && [[ -r "${cap_file}" ]]; then
        battery_pct="$(cat "${cap_file}" 2>/dev/null | tr -cd '0-9')"
      fi
      local status_file
      status_file="$(ls /sys/class/power_supply/BAT*/status 2>/dev/null | head -1 || true)"
      if [[ -n "${status_file}" ]] && [[ -r "${status_file}" ]]; then
        local status_raw
        status_raw="$(tr '[:upper:]' '[:lower:]' < "${status_file}" 2>/dev/null || true)"
        if [[ "${status_raw}" == *charging* ]] || [[ "${status_raw}" == *full* ]]; then
          charging_state="true"
          power_source="ac"
        elif [[ "${status_raw}" == *discharging* ]]; then
          charging_state="false"
          power_source="battery"
        fi
      fi
    elif command -v upower >/dev/null 2>&1; then
      # Fallback: upower (may not be installed)
      local dev
      dev="$(upower -e 2>/dev/null | grep -m1 'battery' || true)"
      if [[ -n "${dev}" ]]; then
        local up_raw
        up_raw="$(upower -i "${dev}" 2>/dev/null || true)"
        battery_pct="$(printf '%s\n' "${up_raw}" | awk '/percentage:/ {gsub(/%/,"",$2); print $2; exit}')"
        if printf '%s\n' "${up_raw}" | awk '/state:/ {print tolower($2); exit}' | grep -q '^charging$'; then
          charging_state="true"
          power_source="ac"
        elif printf '%s\n' "${up_raw}" | awk '/state:/ {print tolower($2); exit}' | grep -q '^discharging$'; then
          charging_state="false"
          power_source="battery"
        fi
      fi
    fi
  fi
  printf '%s|%s|%s|%s|%s\n' "${ram_used_mb:-0}" "${load_val:-0}" "${battery_pct:-}" "${charging_state:-}" "${power_source:-}"
}

collect_network_inventory() {
  if [[ "$(printf '%s' "${TURING_NETWORK_INVENTORY_ENABLED}" | tr '[:upper:]' '[:lower:]')" != "true" ]] || ! command -v python3 >/dev/null 2>&1; then
    return
  fi
  local now
  now="$(date +%s)"
  if (( now - last_network_inventory_at < TURING_NETWORK_INVENTORY_INTERVAL_SEC )); then
    return
  fi
  last_network_inventory_at="${now}"
  network_inventory_json="$(python3 "${SCRIPT_DIR}/network-inventory.py" 2>/dev/null || true)"
}

# Heartbeat loop: report health so backend can show device health and do healing via agent
while true; do
  sleep "${TURING_HEARTBEAT_SEC}"
  TAILSCALE_IP="$(get_tailscale_ip)"
  if [[ -z "${TAILSCALE_IP}" ]]; then
    echo "[turing-agent] Lost Tailscale IP; next heartbeat may use previous IP" >&2
  fi
  health="$(collect_health)"
  collect_network_inventory
  IFS='|' read -r ram_used_mb load_val battery_pct charging_state power_source <<< "${health}"
  payload="{\"device_id\":\"${device_id}\",\"tailscale_ip\":\"${TAILSCALE_IP}\""
  if [[ -n "${ram_used_mb}" ]] && [[ "${ram_used_mb}" =~ ^[0-9]+$ ]]; then
    payload="${payload},\"ram_used_mb\":${ram_used_mb}"
  fi
  if [[ -n "${load_val}" ]] && [[ "${load_val}" =~ ^[0-9]*\.?[0-9]+$ ]]; then
    payload="${payload},\"load\":${load_val}"
  fi
  if [[ -n "${battery_pct}" ]] && [[ "${battery_pct}" =~ ^[0-9]+$ ]]; then
    payload="${payload},\"battery_percent\":${battery_pct}"
  fi
  if [[ "${charging_state}" == "true" ]] || [[ "${charging_state}" == "false" ]]; then
    payload="${payload},\"charging\":${charging_state}"
  fi
  if [[ "${power_source}" == "ac" ]] || [[ "${power_source}" == "battery" ]] || [[ "${power_source}" == "unknown" ]]; then
    payload="${payload},\"power_source\":\"${power_source}\""
  fi
  if [[ "${network_inventory_json}" == \{*\} ]]; then
    payload="${payload},\"network_inventory\":${network_inventory_json}"
  fi
  payload="${payload}}"
  code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND_URL}/api/turing/heartbeat" \
    "${curl_headers[@]}" \
    -d "${payload}")"
  if [[ "${code}" == "200" ]]; then
    echo "[turing-agent] Heartbeat OK (device_id=${device_id} ram_used_mb=${ram_used_mb:-—} load=${load_val:-—} battery=${battery_pct:-—} charging=${charging_state:-—} source=${power_source:-—})"
  else
    echo "[turing-agent] Heartbeat HTTP ${code}" >&2
  fi
done
