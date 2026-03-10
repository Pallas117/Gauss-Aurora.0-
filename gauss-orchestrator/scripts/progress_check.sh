#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Running progress check for gauss-orchestrator..."

missing=0

check_file() {
  if [ ! -e "$ROOT_DIR/$1" ]; then
    echo "MISSING: $1"
    missing=$((missing+1))
  else
    echo "OK: $1"
  fi
}

# Files we expect as part of minimal progress
check_file "Cargo.toml"
check_file "src/lib.rs"
check_file "src/main.rs"
check_file "tests/integration_cloud_local.rs"

# Ensure tests directory exists and at least one test file
if [ ! -d "$ROOT_DIR/tests" ]; then
  echo "MISSING: tests/ directory"
  missing=$((missing+1))
else
  count=$(ls -1 "$ROOT_DIR/tests" | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    echo "MISSING: test files in tests/"
    missing=$((missing+1))
  else
    echo "OK: tests/ contains $count file(s)"
  fi
fi

if [ "$missing" -ne 0 ]; then
  echo "Progress check failed: $missing missing item(s)"
  exit 2
fi

echo "Progress check passed"
exit 0
