# Telegram bot setup (no URL required)

The orchestrator uses **long polling** to talk to Telegram. You do **not** need to set a webhook or any URL.

## What you need

1. **Bot token** – from [@BotFather](https://t.me/botfather) when you create or manage the bot.
2. **Your chat ID** – so the bot knows which conversation to use (send and receive).

## Step 1: Bot token

- Open Telegram → search **@BotFather**.
- Send `/newbot` (or use an existing bot with `/mybots`).
- Copy the token BotFather gives you (e.g. `123456789:ABCdefGHI...`).
- In your `.env` (at repo root or in this folder):

```bash
ORCHESTRATOR_TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
# or
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

## Step 2: Get your chat ID

1. In Telegram, **open a chat with your bot** (search for the bot’s username, e.g. @adagaussbot).
2. **Send any message** to the bot (e.g. `hello` or `/start`).
3. From your machine, run (replace `YOUR_TOKEN` with the real token):

```bash
curl -s "https://api.telegram.org/botYOUR_TOKEN/getUpdates"
```

4. In the JSON, find a `"chat"` object and copy the **`id`** number (e.g. `7909911632`). That’s your chat ID.
5. Put it in `.env`:

```bash
ORCHESTRATOR_TELEGRAM_CHAT_ID=7909911632
# or
TELEGRAM_CHAT_ID=7909911632
```

## Step 3: Restart the orchestrator

Restart so it loads the new env vars. After that:

- The bot sends the “GAUSS Orchestrator Connected” welcome message to that chat.
- You can send commands in that same chat (`/status`, `/help`, `/analyze`, etc.) and the bot will reply there.

## Troubleshooting

| Symptom | Check |
|--------|--------|
| No welcome message | Token correct? Chat ID correct? Restart orchestrator after changing `.env`. |
| Bot doesn’t reply to my messages | Chat ID must be the **same** chat where you’re writing. Get it again with getUpdates after sending a message in that chat. |
| “Telegram wired” but nothing in Telegram | `.env` is loaded from **repo root** when you run `npm run dev:orchestrator`. Put vars in the root `.env`, or export them before running. |

No webhook or URL is required; the orchestrator polls Telegram automatically.
