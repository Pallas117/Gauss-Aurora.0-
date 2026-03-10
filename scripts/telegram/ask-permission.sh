#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

load_env_file() {
  local file="${1:-}"
  [[ -f "${file}" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue

    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "${line}" =~ ^export[[:space:]]+ ]]; then
      line="${line#export }"
      line="${line#"${line%%[![:space:]]*}"}"
    fi

    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${value#"${value%%[![:space:]]*}"}"

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:-1}"
    fi

    printf -v "${key}" '%s' "${value}"
    export "${key}"
  done < "${file}"
}

load_env_file "${ENV_FILE}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/telegram/ask-permission.sh [options] [message...]

Options:
  -m, --message <text>      Message text to send.
      --chat-id <id>        Override TELEGRAM_CHAT_ID.
      --bot-token <token>   Override TELEGRAM_BOT_TOKEN.
  -q, --quiet               Print only success/failure summary.
  -h, --help                Show this help text.

Environment:
  TELEGRAM_BOT_TOKEN        Bot token from @BotFather.
  TELEGRAM_CHAT_ID          Target chat id or user id.
  GAUSS_TELEGRAM_SENDER     Optional sender label (default: "Gauss Ops").

Example:
  npm run telegram:ask-permission -- "Permission request: Can I go out?"
EOF
}

MESSAGE_ARG=""
QUIET=false
CHAT_ID_OVERRIDE=""
BOT_TOKEN_OVERRIDE=""

while (($# > 0)); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -q|--quiet)
      QUIET=true
      shift
      ;;
    -m|--message)
      shift
      if (($# == 0)); then
        echo "Error: --message requires a value." >&2
        exit 1
      fi
      MESSAGE_ARG="$1"
      shift
      ;;
    --chat-id)
      shift
      if (($# == 0)); then
        echo "Error: --chat-id requires a value." >&2
        exit 1
      fi
      CHAT_ID_OVERRIDE="$1"
      shift
      ;;
    --bot-token)
      shift
      if (($# == 0)); then
        echo "Error: --bot-token requires a value." >&2
        exit 1
      fi
      BOT_TOKEN_OVERRIDE="$1"
      shift
      ;;
    *)
      if [[ -z "${MESSAGE_ARG}" ]]; then
        MESSAGE_ARG="$1"
      else
        MESSAGE_ARG="${MESSAGE_ARG} $1"
      fi
      shift
      ;;
  esac
done

BOT_TOKEN="${BOT_TOKEN_OVERRIDE:-${TELEGRAM_BOT_TOKEN:-}}"
CHAT_ID="${CHAT_ID_OVERRIDE:-${TELEGRAM_CHAT_ID:-}}"
SENDER="${GAUSS_TELEGRAM_SENDER:-Gauss Ops}"

if [[ -z "${BOT_TOKEN}" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN is missing." >&2
  exit 1
fi

if [[ -z "${CHAT_ID}" ]]; then
  echo "Error: TELEGRAM_CHAT_ID is missing." >&2
  exit 1
fi

if [[ -z "${MESSAGE_ARG}" ]]; then
  MESSAGE_ARG="Permission request: Can I go out? Reply YES or NO."
fi

TIMESTAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
MESSAGE_TEXT="${MESSAGE_ARG}"$'\n\n'"source: ${SENDER}"$'\n'"utc: ${TIMESTAMP_UTC}"

RESPONSE="$(curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE_TEXT}" \
  --data-urlencode "disable_web_page_preview=true" \
  --data-urlencode "disable_notification=false")"

if command -v jq >/dev/null 2>&1; then
  OK="$(printf '%s' "${RESPONSE}" | jq -r '.ok // false')"
  if [[ "${OK}" != "true" ]]; then
    DESC="$(printf '%s' "${RESPONSE}" | jq -r '.description // "Unknown Telegram API error"')"
    echo "Telegram send failed: ${DESC}" >&2
    exit 1
  fi
  MESSAGE_ID="$(printf '%s' "${RESPONSE}" | jq -r '.result.message_id // "n/a"')"
  if [[ "${QUIET}" == "true" ]]; then
    echo "ok message_id=${MESSAGE_ID}"
  else
    echo "Telegram message sent."
    echo "chat_id: ${CHAT_ID}"
    echo "message_id: ${MESSAGE_ID}"
    echo "text: ${MESSAGE_ARG}"
  fi
else
  if [[ "${RESPONSE}" != *'"ok":true'* ]]; then
    echo "Telegram send failed: ${RESPONSE}" >&2
    exit 1
  fi
  if [[ "${QUIET}" == "true" ]]; then
    echo "ok"
  else
    echo "Telegram message sent."
    echo "chat_id: ${CHAT_ID}"
    echo "text: ${MESSAGE_ARG}"
  fi
fi
