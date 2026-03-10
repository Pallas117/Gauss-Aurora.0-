#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  echo "Error: run from inside a git repository." >&2
  exit 1
fi

ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
HOOK_LINE="source \"${ROOT}/scripts/progress/gauss-progress-hook.zsh\""

if [[ -f "${ZSHRC}" ]] && grep -Fq "${HOOK_LINE}" "${ZSHRC}"; then
  echo "Gauss progress hook already installed in ${ZSHRC}"
  exit 0
fi

{
  echo ""
  echo "# Gauss progress checker prompt hook"
  echo "${HOOK_LINE}"
} >> "${ZSHRC}"

echo "Installed Gauss progress hook in ${ZSHRC}"
echo "Run: source \"${ZSHRC}\""
