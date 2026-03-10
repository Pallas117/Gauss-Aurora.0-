#!/usr/bin/env bash
# Load .env from repo root and print your Telegram chat ID from getUpdates.
# Usage: run from repo root, or pass token: TELEGRAM_BOT_TOKEN=xxx bash scripts/process/get-telegram-chat-id.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -f "${ROOT}/.env" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" ]] && continue
    if [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*=(.*)$ ]]; then
      key="${line%%=*}"
      val="${line#*=}"
      val="${val#"${val%%[![:space:]]*}"}"
      export "${key}=${val}"
    fi
  done < "${ROOT}/.env"
fi

TOKEN="${ORCHESTRATOR_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
if [[ -z "${TOKEN}" ]]; then
  echo "No Telegram token found. Set ORCHESTRATOR_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN in ${ROOT}/.env" >&2
  exit 1
fi

echo "Fetching updates (send a message to your bot in Telegram first)..." >&2
JSON="$(curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates")"
if ! echo "${JSON}" | grep -q '"ok":true'; then
  echo "API error: ${JSON}" >&2
  exit 1
fi

# Extract chat.id from message.chat (avoid update_id / from.id)
CHAT_IDS="$(echo "${JSON}" | grep -o '"chat":[^}]*"id":[0-9]*' | grep -o '[0-9]*$' | sort -u)"
if [[ -n "${CHAT_IDS}" ]]; then
  echo "Chat ID(s) to use for ORCHESTRATOR_TELEGRAM_CHAT_ID:"
  echo "${CHAT_IDS}"
else
  echo "No chat found. Send any message to your bot in Telegram, then run this again." >&2
fi
