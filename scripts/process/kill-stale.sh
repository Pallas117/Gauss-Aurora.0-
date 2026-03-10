#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

PORTS=(
  3001
  3002
  8080
  8081
  8089
  5173
  5174
  5175
)

declare -a TARGET_PIDS=()

for port in "${PORTS[@]}"; do
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    TARGET_PIDS+=("${pid}")
  done < <(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)
done

if [[ ${#TARGET_PIDS[@]} -eq 0 ]]; then
  echo "[process:prune] no stale dev listeners found on tracked ports."
  exit 0
fi

# unique pids (bash 3.2 compatible)
declare -a UNIQUE_PIDS=()
while IFS= read -r pid; do
  [[ -n "${pid}" ]] || continue
  UNIQUE_PIDS+=("${pid}")
done < <(printf '%s\n' "${TARGET_PIDS[@]}" | sort -u)

echo "[process:prune] found ${#UNIQUE_PIDS[@]} listener process(es): ${UNIQUE_PIDS[*]}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "[process:prune] dry-run mode, no processes killed."
  exit 0
fi

kill -TERM "${UNIQUE_PIDS[@]}" 2>/dev/null || true
sleep 1

declare -a REMAINING=()
for pid in "${UNIQUE_PIDS[@]}"; do
  if kill -0 "${pid}" 2>/dev/null; then
    REMAINING+=("${pid}")
  fi
done

if [[ ${#REMAINING[@]} -gt 0 ]]; then
  echo "[process:prune] force-killing remaining: ${REMAINING[*]}"
  kill -KILL "${REMAINING[@]}" 2>/dev/null || true
fi

echo "[process:prune] complete."
