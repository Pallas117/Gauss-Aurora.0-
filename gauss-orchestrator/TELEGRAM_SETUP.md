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

```
ORCHESTRATOR_TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```
(or `TELEGRAM_BOT_TOKEN=...` – the run script maps it.)

## Step 2: Get your chat ID

1. In Telegram, **open a chat with your bot** (search for the bot username, e.g. @adagaussbot).
2. **Send any message** to the bot (e.g. `hello` or `/start`).
3. From your machine run (replace `YOUR_TOKEN` with the real token):

```bash
curl -s "https://api.telegram.org/botYOUR_TOKEN/getUpdates"
```

4. In the JSON, find a `"chat"` object and copy the **`id`** number. That is your chat ID.
5. Put it in `.env`:

```
ORCHESTRATOR_TELEGRAM_CHAT_ID=7909911632
```
(or `TELEGRAM_CHAT_ID=...`.)

## Step 3: Restart the orchestrator

Restart so it loads the new env. After that the bot sends the welcome message to that chat and you can send `/status`, `/help`, etc. in the same chat.

## Troubleshooting

- **No welcome message:** Check token and chat ID; restart after changing `.env`.
- **Bot does not reply:** Chat ID must be the same chat where you send messages. Get it again with getUpdates after sending a message in that chat.
- **Vars not loaded:** When you run `npm run dev:orchestrator`, `.env` is loaded from the **repo root**. Put Telegram vars in the root `.env`.

No webhook or URL is required.
