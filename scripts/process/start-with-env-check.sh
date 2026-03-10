#!/usr/bin/env bash
# Optional: run backend env check, then start the full stack (FE + API + brain stub).
# Usage: ./scripts/process/start-with-env-check.sh   (or npm run start:safe)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "${ROOT}"

echo "Checking backend environment..."
if ! npm run check:backend-env 2>/dev/null; then
  echo ""
  echo "Backend env check reported issues. Copy .env.example to .env and set required keys."
  echo "Continue anyway? [y/N]"
  read -r ans
  if [[ "${ans}" != "y" && "${ans}" != "Y" ]]; then
    exit 1
  fi
fi

echo ""
echo "Starting stack (frontend + backend + brain stub)..."
exec npm run start
