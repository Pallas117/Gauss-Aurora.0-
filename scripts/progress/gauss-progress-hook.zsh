#!/usr/bin/env zsh

# Source this file from ~/.zshrc to print Gauss progress periodically at prompt time.
# Safe to source multiple times.

if [[ -n "${GAUSS_PROGRESS_HOOK_LOADED:-}" ]]; then
  return 0
fi

export GAUSS_PROGRESS_HOOK_LOADED=1

typeset -g _GAUSS_HOOK_DIR="$(cd "$(dirname "${(%):-%N}")" && pwd)"
typeset -g _GAUSS_HOOK_ROOT="$(cd "${_GAUSS_HOOK_DIR}/../.." && pwd)"

# Recover automatically if an old/stale root is exported in the shell.
if [[ -z "${GAUSS_PROGRESS_ROOT:-}" ]] || [[ ! -d "${GAUSS_PROGRESS_ROOT}" ]]; then
  export GAUSS_PROGRESS_ROOT="${_GAUSS_HOOK_ROOT}"
fi

if [[ -z "${GAUSS_PROGRESS_SCRIPT:-}" ]] || [[ ! -f "${GAUSS_PROGRESS_SCRIPT}" ]]; then
  export GAUSS_PROGRESS_SCRIPT="${GAUSS_PROGRESS_ROOT}/tools/progress-checker/gauss_progress_bar.py"
fi

if [[ -z "${GAUSS_BACKPROP_SCRIPT:-}" ]] || [[ ! -f "${GAUSS_BACKPROP_SCRIPT}" ]]; then
  export GAUSS_BACKPROP_SCRIPT="${GAUSS_PROGRESS_ROOT}/tools/progress-checker/gauss_backprop_scaffold.py"
fi

# Minimum seconds between automatic checks to avoid noisy prompts.
: "${GAUSS_PROGRESS_INTERVAL:=10}"
: "${GAUSS_PROGRESS_ENABLED:=1}"
: "${GAUSS_BACKPROP_PROMPT_ENABLED:=1}"

typeset -g _GAUSS_PROGRESS_LAST_TS=0

autoload -Uz add-zsh-hook

_gauss_progress_precmd() {
  [[ "${GAUSS_PROGRESS_ENABLED}" == "1" ]] || return

  # Self-heal during long-lived shells after repo path changes.
  if [[ -z "${GAUSS_PROGRESS_ROOT:-}" ]] || [[ ! -d "${GAUSS_PROGRESS_ROOT}" ]]; then
    export GAUSS_PROGRESS_ROOT="${_GAUSS_HOOK_ROOT}"
    export GAUSS_PROGRESS_SCRIPT="${GAUSS_PROGRESS_ROOT}/tools/progress-checker/gauss_progress_bar.py"
    export GAUSS_BACKPROP_SCRIPT="${GAUSS_PROGRESS_ROOT}/tools/progress-checker/gauss_backprop_scaffold.py"
  fi

  [[ -f "${GAUSS_PROGRESS_SCRIPT}" ]] || return

  case "${PWD}/" in
    "${GAUSS_PROGRESS_ROOT}/"* ) ;;
    * ) return ;;
  esac

  local now=${EPOCHSECONDS:-0}
  if (( now - _GAUSS_PROGRESS_LAST_TS < GAUSS_PROGRESS_INTERVAL )); then
    return
  fi
  _GAUSS_PROGRESS_LAST_TS=${now}

  python3 "${GAUSS_PROGRESS_SCRIPT}" --short --no-color 2>/dev/null || true
  if [[ "${GAUSS_BACKPROP_PROMPT_ENABLED}" == "1" ]] && [[ -f "${GAUSS_BACKPROP_SCRIPT}" ]]; then
    python3 "${GAUSS_BACKPROP_SCRIPT}" --short 2>/dev/null || true
  fi
}

add-zsh-hook precmd _gauss_progress_precmd
