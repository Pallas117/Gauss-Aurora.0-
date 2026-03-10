#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${ROOT}"

printf 'Gauss Aurora workspace (coding-focused view)\n'
printf '=============================================\n'

find . \
  -path './.git' -prune -o \
  -path './node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './test-results' -prune -o \
  -path './reports/fullstack' -prune -o \
  -path './.pytest_cache' -prune -o \
  -path './supabase/.temp' -prune -o \
  -path './gauss-orchestrator/target' -prune -o \
  -path './research/legacy-v0-1/.vite' -prune -o \
  -path '*/__pycache__' -prune -o \
  -path './picoclaw/.git' -prune -o \
  -type d -maxdepth 2 -print \
| sed -e 's#^\./##' \
| sort
