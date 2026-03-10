#!/usr/bin/env bash
# Discover devices on the Tailscale mesh and register them with the Gauss backend
# so they appear in the Turing pool. Run on a machine that has Tailscale and can
# reach the backend (e.g. your main dev machine or a small always-on node).
#
# Usage:
#   BACKEND_URL=https://100.x.y.z:3001 ./sync-from-tailscale.sh
#   BACKEND_URL=http://localhost:3001 TURING_SECRET=xxx ./sync-from-tailscale.sh --dry-run
#
# Requires: tailscale CLI, jq
# Optional: TURING_SECRET (same as TURING_REGISTER_SECRET on backend)
#           DEFAULT_CAPABILITIES (comma-separated, default: cache)
#           DEFAULT_RAM_MB (default: 0 = unknown)
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-}"
TURING_SECRET="${TURING_SECRET:-}"
DEFAULT_CAPABILITIES="${DEFAULT_CAPABILITIES:-cache}"
DEFAULT_RAM_MB="${DEFAULT_RAM_MB:-0}"
DRY_RUN=false

for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Unknown argument: ${arg}. Use --dry-run to only print what would be registered." >&2
      exit 2
      ;;
  esac
done

BACKEND_URL="${BACKEND_URL%/}"
if [[ -z "${BACKEND_URL}" ]]; then
  echo "ERROR: BACKEND_URL is required" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "ERROR: tailscale CLI not found. Install Tailscale." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required. Install jq." >&2
  exit 1
fi

status_json="$(tailscale status --json 2>/dev/null)" || true
if [[ -z "${status_json}" ]]; then
  echo "ERROR: tailscale status --json failed. Is Tailscale running?" >&2
  exit 1
fi

# Build capabilities JSON array from DEFAULT_CAPABILITIES
cap_json="["
first=1
while IFS= read -r -d ',' cap; do
  cap="$(echo "${cap}" | tr -d ' ')"; [[ -z "${cap}" ]] && continue
  [[ $first -eq 1 ]] && first=0 || cap_json+=","
  cap_json+="\"${cap}\""
done <<< "${DEFAULT_CAPABILITIES},"
cap_json+="]"

# Extract Self (this machine) and all Peers: need TailscaleIP (first IPv4) and hostname.
# JSON has .Self (PeerStatus) and .Peer (map of nodekey -> PeerStatus). PeerStatus has
# TailscaleIPs (array), HostName, DNSName.
register_one() {
  local ip="$1"
  local hostname="$2"
  [[ -z "${ip}" ]] && return 1
  # Skip non-CGNAT / non-Tailscale IPs if we want only tailnet IPs
  if [[ ! "${ip}" =~ ^100\. ]]; then
    return 0
  fi
  hostname="${hostname:-device-${ip//./-}}"
  hostname="$(echo "${hostname}" | sed 's/["\\]/_/g')"
  payload="{\"hostname\":\"${hostname}\",\"tailscale_ip\":\"${ip}\",\"ram_mb\":${DEFAULT_RAM_MB},\"capabilities\":${cap_json}}"
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[sync] Would register: hostname=${hostname} tailscale_ip=${ip}"
    return 0
  fi
  curl_headers=(-H "Content-Type: application/json")
  [[ -n "${TURING_SECRET}" ]] && curl_headers+=(-H "X-Turing-Secret: ${TURING_SECRET}")
  code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BACKEND_URL}/api/turing/register" \
    "${curl_headers[@]}" -d "${payload}")"
  if [[ "${code}" == "201" ]]; then
    echo "[sync] Registered: ${hostname} (${ip})"
  else
    echo "[sync] Failed ${code} for ${hostname} (${ip})" >&2
  fi
}

# Self
self_ip="$(echo "${status_json}" | jq -r '.Self.TailscaleIPs[0] // empty' 2>/dev/null)"
self_name="$(echo "${status_json}" | jq -r '.Self.HostName // .Self.DNSName // "self" | @json' 2>/dev/null)"
self_name="${self_name%\"}"; self_name="${self_name#\"}"
if [[ -n "${self_ip}" ]]; then
  register_one "${self_ip}" "${self_name}"
fi

# Peers
peers_json="$(echo "${status_json}" | jq -c '.Peer // {} | to_entries[] | {ip: (.value.TailscaleIPs[0] // ""), name: (.value.HostName // .value.DNSName // "peer")}' 2>/dev/null)" || true
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  ip="$(echo "${line}" | jq -r '.ip // empty')"
  name="$(echo "${line}" | jq -r '.name // "peer" | @json')"
  name="${name%\"}"; name="${name#\"}"
  register_one "${ip}" "${name}"
done <<< "${peers_json}"

echo "[sync] Done."
