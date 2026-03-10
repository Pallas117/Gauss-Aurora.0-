#!/usr/bin/env bash
set -euo pipefail

# Overnight system monitor for Project Gauss on macOS.
# Captures battery/power source, CPU usage, memory pressure, GPU utilization,
# and Gauss process CPU/memory totals into JSONL + process logs.

INTERVAL_SEC="${MONITOR_INTERVAL_SEC:-60}"
DURATION_HOURS="${MONITOR_DURATION_HOURS:-10}"
OUTPUT_DIR="${MONITOR_OUTPUT_DIR:-reports/monitoring}"
LABEL="${MONITOR_LABEL:-overnight-$(date +%Y%m%d-%H%M%S)}"
TRACK_RE="${MONITOR_TRACK_REGEX:-vite|backend/server\\.ts|gauss-orchestrator|surya_service\\.py|rag/server\\.py|mlx}"

if ! [[ "${INTERVAL_SEC}" =~ ^[0-9]+$ ]] || [[ "${INTERVAL_SEC}" -lt 5 ]]; then
  echo "[monitor] MONITOR_INTERVAL_SEC must be an integer >= 5" >&2
  exit 1
fi

if ! [[ "${DURATION_HOURS}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "[monitor] MONITOR_DURATION_HOURS must be numeric" >&2
  exit 1
fi

MAX_SAMPLES="$(awk -v h="${DURATION_HOURS}" -v i="${INTERVAL_SEC}" 'BEGIN { printf "%.0f", (h*3600)/i }')"
if ! [[ "${MAX_SAMPLES}" =~ ^[0-9]+$ ]] || [[ "${MAX_SAMPLES}" -lt 1 ]]; then
  echo "[monitor] computed sample count is invalid" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

JSONL_PATH="${OUTPUT_DIR}/${LABEL}.jsonl"
PROC_PATH="${OUTPUT_DIR}/${LABEL}.processes.log"
RUN_LOG_PATH="${OUTPUT_DIR}/${LABEL}.run.log"
SUMMARY_PATH="${OUTPUT_DIR}/${LABEL}.summary.txt"
PID_PATH="${OUTPUT_DIR}/${LABEL}.pid"
LATEST_SYMLINK="${OUTPUT_DIR}/latest"

: > "${JSONL_PATH}"
: > "${PROC_PATH}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

num_or_null() {
  local v="${1:-}"
  if [[ "${v}" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
    printf '%s' "${v}"
  else
    printf 'null'
  fi
}

str_or_null() {
  local v="${1:-}"
  if [[ -z "${v}" ]]; then
    printf 'null'
  else
    printf '"%s"' "$(json_escape "${v}")"
  fi
}

write_summary() {
  local sample_count first_battery last_battery elapsed_hours drain_per_hour
  if [[ ! -f "${JSONL_PATH}" ]]; then
    : > "${JSONL_PATH}"
  fi
  sample_count="$(wc -l < "${JSONL_PATH}" | tr -d ' ')"
  first_battery="$(sed -nE 's/.*"battery_percent":([0-9.]+).*/\1/p' "${JSONL_PATH}" | head -n 1 || true)"
  last_battery="$(sed -nE 's/.*"battery_percent":([0-9.]+).*/\1/p' "${JSONL_PATH}" | tail -n 1 || true)"
  elapsed_hours="$(awk -v n="${sample_count}" -v i="${INTERVAL_SEC}" 'BEGIN { if (n > 1) printf "%.2f", ((n-1)*i)/3600; else printf "0.00" }')"
  drain_per_hour="$(awk -v a="${first_battery:-}" -v b="${last_battery:-}" -v h="${elapsed_hours}" '
    BEGIN {
      if (a == "" || b == "" || h == 0) { print "n/a"; exit }
      printf "%.2f", (a-b)/h
    }'
  )"

  {
    echo "Overnight Resource Monitor Summary"
    echo "label: ${LABEL}"
    echo "jsonl: ${JSONL_PATH}"
    echo "processes: ${PROC_PATH}"
    echo "interval_sec: ${INTERVAL_SEC}"
    echo "requested_duration_hours: ${DURATION_HOURS}"
    echo "samples_captured: ${sample_count}"
    echo "elapsed_hours: ${elapsed_hours}"
    echo "battery_start_percent: ${first_battery:-n/a}"
    echo "battery_end_percent: ${last_battery:-n/a}"
    echo "battery_drain_percent_per_hour: ${drain_per_hour}"
    echo
    awk '
      function value_for(field,   pattern, token) {
        pattern = "\"" field "\":[0-9.]+"
        if (match($0, pattern)) {
          token = substr($0, RSTART, RLENGTH)
          sub("^\"" field "\":", "", token)
          return token + 0
        }
        return ""
      }
      function bump(name, value,   v) {
        if (value == "") return
        v = value + 0
        sum[name] += v
        count[name] += 1
        if (!(name in min) || v < min[name]) min[name] = v
        if (!(name in max) || v > max[name]) max[name] = v
      }
      {
        bump("cpu_user_pct", value_for("cpu_user_pct"))
        bump("cpu_sys_pct", value_for("cpu_sys_pct"))
        bump("cpu_idle_pct", value_for("cpu_idle_pct"))
        bump("gpu_device_util_pct", value_for("gpu_device_util_pct"))
        bump("gpu_renderer_util_pct", value_for("gpu_renderer_util_pct"))
        bump("gpu_tiler_util_pct", value_for("gpu_tiler_util_pct"))
        bump("gauss_cpu_pct", value_for("gauss_cpu_pct"))
        bump("gauss_rss_mb", value_for("gauss_rss_mb"))
        bump("load_avg_1m", value_for("load_avg_1m"))
      }
      END {
        print "metric,avg,min,max,samples"
        for (k in count) {
          printf "%s,%.2f,%.2f,%.2f,%d\n", k, sum[k]/count[k], min[k], max[k], count[k]
        }
      }
    ' "${JSONL_PATH}"
  } > "${SUMMARY_PATH}"

  echo "[monitor] summary written: ${SUMMARY_PATH}" | tee -a "${RUN_LOG_PATH}"
}

cleanup() {
  rm -f "${PID_PATH}" || true
  write_summary || true
}

trap cleanup EXIT INT TERM

echo "$$" > "${PID_PATH}"
ln -sfn "${LABEL}" "${LATEST_SYMLINK}"

{
  echo "[monitor] started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[monitor] pid=$$"
  echo "[monitor] interval_sec=${INTERVAL_SEC}"
  echo "[monitor] duration_hours=${DURATION_HOURS}"
  echo "[monitor] max_samples=${MAX_SAMPLES}"
  echo "[monitor] output_jsonl=${JSONL_PATH}"
  echo "[monitor] output_processes=${PROC_PATH}"
} | tee -a "${RUN_LOG_PATH}"

for ((sample=1; sample<=MAX_SAMPLES; sample++)); do
  ts_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ts_local="$(date +%Y-%m-%dT%H:%M:%S%z)"

  batt_raw="$(pmset -g batt 2>/dev/null || true)"
  power_source="$(printf '%s\n' "${batt_raw}" | awk -F"'" '/Now drawing from/ {print $2; exit}')"
  battery_percent="$(printf '%s\n' "${batt_raw}" | grep -Eo '[0-9]+%' | head -n 1 | tr -d '%' || true)"
  battery_state="$(printf '%s\n' "${batt_raw}" | awk -F'; ' 'NR==2 {print $2; exit}')"

  top_raw="$(top -l 1 -n 0 2>/dev/null || true)"
  cpu_line="$(printf '%s\n' "${top_raw}" | awk '/CPU usage:/ {print; exit}')"
  load_line="$(printf '%s\n' "${top_raw}" | awk '/Load Avg:/ {print; exit}')"
  mem_line="$(printf '%s\n' "${top_raw}" | awk '/PhysMem:/ {print; exit}')"

  cpu_user_pct="$(printf '%s\n' "${cpu_line}" | sed -nE 's/.*CPU usage: *([0-9.]+)% user.*/\1/p')"
  cpu_sys_pct="$(printf '%s\n' "${cpu_line}" | sed -nE 's/.*% user, *([0-9.]+)% sys.*/\1/p')"
  cpu_idle_pct="$(printf '%s\n' "${cpu_line}" | sed -nE 's/.*% sys, *([0-9.]+)% idle.*/\1/p')"

  load_avg_1m="$(printf '%s\n' "${load_line}" | sed -nE 's/.*Load Avg: *([0-9.]+), *([0-9.]+), *([0-9.]+).*/\1/p')"
  load_avg_5m="$(printf '%s\n' "${load_line}" | sed -nE 's/.*Load Avg: *([0-9.]+), *([0-9.]+), *([0-9.]+).*/\2/p')"
  load_avg_15m="$(printf '%s\n' "${load_line}" | sed -nE 's/.*Load Avg: *([0-9.]+), *([0-9.]+), *([0-9.]+).*/\3/p')"

  mem_used_mb="$(printf '%s\n' "${mem_line}" | sed -nE 's/.*PhysMem: *([0-9]+)M used.*/\1/p')"
  mem_wired_mb="$(printf '%s\n' "${mem_line}" | sed -nE 's/.*\(([0-9]+)M wired.*/\1/p')"
  mem_compressor_mb="$(printf '%s\n' "${mem_line}" | sed -nE 's/.*wired, *([0-9]+)M compressor.*/\1/p')"
  mem_unused_mb="$(printf '%s\n' "${mem_line}" | sed -nE 's/.*, *([0-9]+)M unused.*/\1/p')"

  gpu_line="$(
    ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null \
      | awk '/PerformanceStatistics/ && line == "" { line = $0 } END { if (line != "") print line }' \
      || true
  )"
  gpu_device_util_pct="$(printf '%s\n' "${gpu_line}" | sed -nE 's/.*"Device Utilization %"=([0-9]+).*/\1/p')"
  gpu_renderer_util_pct="$(printf '%s\n' "${gpu_line}" | sed -nE 's/.*"Renderer Utilization %"=([0-9]+).*/\1/p')"
  gpu_tiler_util_pct="$(printf '%s\n' "${gpu_line}" | sed -nE 's/.*"Tiler Utilization %"=([0-9]+).*/\1/p')"
  gpu_in_use_mem_bytes="$(printf '%s\n' "${gpu_line}" | sed -nE 's/.*"In use system memory"=([0-9]+).*/\1/p')"
  gpu_alloc_mem_bytes="$(printf '%s\n' "${gpu_line}" | sed -nE 's/.*"Alloc system memory"=([0-9]+).*/\1/p')"

  gauss_rollup="$(
    ps -A -o %cpu=,rss=,command= 2>/dev/null | awk -v re="${TRACK_RE}" '
      BEGIN { IGNORECASE = 1 }
      {
        row = tolower($0)
        if (row ~ re) {
          cpu += $1
          rss += $2
          count += 1
        }
      }
      END {
        printf "%.2f %.1f %d", cpu + 0, rss / 1024, count + 0
      }'
  )"
  gauss_cpu_pct="$(printf '%s\n' "${gauss_rollup}" | awk '{print $1}')"
  gauss_rss_mb="$(printf '%s\n' "${gauss_rollup}" | awk '{print $2}')"
  gauss_process_count="$(printf '%s\n' "${gauss_rollup}" | awk '{print $3}')"

  printf '{"ts_utc":"%s","ts_local":"%s","sample":%s,"interval_sec":%s,"power_source":%s,"battery_percent":%s,"battery_state":%s,"cpu_user_pct":%s,"cpu_sys_pct":%s,"cpu_idle_pct":%s,"load_avg_1m":%s,"load_avg_5m":%s,"load_avg_15m":%s,"mem_used_mb":%s,"mem_wired_mb":%s,"mem_compressor_mb":%s,"mem_unused_mb":%s,"gpu_device_util_pct":%s,"gpu_renderer_util_pct":%s,"gpu_tiler_util_pct":%s,"gpu_in_use_mem_bytes":%s,"gpu_alloc_mem_bytes":%s,"gauss_cpu_pct":%s,"gauss_rss_mb":%s,"gauss_process_count":%s}\n' \
    "${ts_utc}" \
    "${ts_local}" \
    "${sample}" \
    "${INTERVAL_SEC}" \
    "$(str_or_null "${power_source}")" \
    "$(num_or_null "${battery_percent}")" \
    "$(str_or_null "${battery_state}")" \
    "$(num_or_null "${cpu_user_pct}")" \
    "$(num_or_null "${cpu_sys_pct}")" \
    "$(num_or_null "${cpu_idle_pct}")" \
    "$(num_or_null "${load_avg_1m}")" \
    "$(num_or_null "${load_avg_5m}")" \
    "$(num_or_null "${load_avg_15m}")" \
    "$(num_or_null "${mem_used_mb}")" \
    "$(num_or_null "${mem_wired_mb}")" \
    "$(num_or_null "${mem_compressor_mb}")" \
    "$(num_or_null "${mem_unused_mb}")" \
    "$(num_or_null "${gpu_device_util_pct}")" \
    "$(num_or_null "${gpu_renderer_util_pct}")" \
    "$(num_or_null "${gpu_tiler_util_pct}")" \
    "$(num_or_null "${gpu_in_use_mem_bytes}")" \
    "$(num_or_null "${gpu_alloc_mem_bytes}")" \
    "$(num_or_null "${gauss_cpu_pct}")" \
    "$(num_or_null "${gauss_rss_mb}")" \
    "$(num_or_null "${gauss_process_count}")" \
    >> "${JSONL_PATH}"

  {
    echo "----- ${ts_local} sample=${sample} -----"
    ps -A -o pid=,%cpu=,%mem=,rss=,comm= 2>/dev/null | sort -k2 -nr | head -n 15
  } >> "${PROC_PATH}" || true

  if (( sample < MAX_SAMPLES )); then
    sleep "${INTERVAL_SEC}"
  fi
done

echo "[monitor] completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "${RUN_LOG_PATH}"
