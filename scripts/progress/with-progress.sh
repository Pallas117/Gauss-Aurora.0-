#!/usr/bin/env bash
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  echo "Error: run from inside a git repository." >&2
  exit 2
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: bash scripts/progress/with-progress.sh <command> [args...]" >&2
  exit 2
fi

"$@"
status=$?

python3 "${ROOT}/tools/progress-checker/gauss_progress_bar.py" --short --record-history || true
if [[ "${GAUSS_BACKPROP_AFTER:-1}" == "1" ]]; then
  python3 "${ROOT}/tools/progress-checker/gauss_backprop_scaffold.py" --write --short || true
fi
exit ${status}
