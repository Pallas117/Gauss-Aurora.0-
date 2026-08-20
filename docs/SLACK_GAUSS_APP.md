# Gauss Slack App

This contract defines the Slack app named `gauss`. It is an observer and operator interface for the repository's bounded agents; it is not an unrestricted shell agent.

## What it does

- Responds to `/gauss help`, `/gauss status`, `/gauss agents`, and `/gauss radiation`.
- Responds to `@gauss` mentions in channels where the app has been added.
- Publishes one bounded daily radiation/space-weather brief to the configured operations channel.
- Reports observed, inferred, unknown, and blocked states explicitly.
- Keeps approvals, deployment, spacecraft commands, and destructive actions outside Slack's automatic authority.

## Create and install the app

1. In Slack API, choose **Create New App** → **From an app manifest**.
2. Select the target workspace and paste [`config/slack/gauss-app-manifest.yaml`](../config/slack/gauss-app-manifest.yaml).
3. Review the scopes, enable Socket Mode, and create an app-level token with `connections:write`.
4. Install the app to the workspace and copy the bot token. Never commit either token or the signing secret.
5. Invite `@gauss` to `#all-gauss` and any channel where members should interact with it.

Slack's Socket Mode uses an app-level token to establish the app's WebSocket connection, while `chat:write` permits the bot to post messages. The daily post can use Slack's scheduled-message API or the repository scheduler; keep one scheduler authoritative to avoid duplicates. See the [official Socket Mode documentation](https://api.slack.com/apis/connections/socket) and [official message scheduling documentation](https://api.slack.com/messaging/sending).

## Secret-backed runtime configuration

Provision these only on the Kali backend/agent host or the dedicated bot runner:

```bash
GAUSS_SLACK_ENABLED=true
GAUSS_SLACK_BOT_TOKEN=xoxb-...
GAUSS_SLACK_APP_TOKEN=xapp-...
GAUSS_SLACK_SIGNING_SECRET=...
GAUSS_SLACK_CHANNEL_ID=C0BASE2GYKB
GAUSS_SLACK_DAILY_RADIATION_ENABLED=true
GAUSS_SLACK_DAILY_RADIATION_TIME=08:00
GAUSS_SLACK_TIMEZONE=Asia/Kuala_Lumpur
```

Do not place these values in `.env.example`, git, Slack messages, or model prompts. Use a secret manager or a mode-`0600` host environment file.

## Interaction boundary

Read-only commands may summarize repository health, active agents, queued proposals, and the latest radiation state. Any patch, approval, deployment, spacecraft command, or external-system mutation must continue through the existing authenticated approval path. Slack notifications are not approvals.

## Current truth state

The repository now contains the app manifest and operating contract. The Slack app itself is **not installed yet** because app creation, workspace installation, and token issuance require a Slack workspace administrator. Do not report the bot as online until a Socket Mode heartbeat and a test message are observed.
