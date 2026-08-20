#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export GAUSS_REPO_ROOT="${GAUSS_REPO_ROOT:-$ROOT_DIR}"

cd "$ROOT_DIR/tools/picoclaw-offline"
exec go run . --repo-root "$GAUSS_REPO_ROOT" "$@"
