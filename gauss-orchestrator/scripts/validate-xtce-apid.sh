#!/usr/bin/env bash
# Validate apid-map against XTCE dictionary (Task 4 / GAUSS-COMP-003).
# Run from repo root or gauss-orchestrator. Exits non-zero on validation failure.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Validating XTCE and apid-map (config/xtce/)..."
cargo test baseline_xtce_and_apid_map_validate --no-fail-fast --quiet
echo "OK: apid-map matches XTCE ParameterSet and ParameterTypeSet."
