# PicoClaw Offline Automations

Gauss can now mirror the local repair automations into PicoClaw's cron store so they still run when the network drops.

## What it does

- Syncs the Codex automation definitions for:
  - `fetch-self-repair`
  - `service-reanimator`
  - `offline-repair-loop`
  - `auth-env-guard`
- Installs those jobs into `~/.picoclaw/workspace/cron/jobs.json`
- Runs them with a repo-owned PicoClaw-based cron runner that executes local shell commands only

## Commands

```bash
npm run picoclaw:offline:install
npm run picoclaw:offline:run
```

The runner uses PicoClaw's cron store and scheduler but does not require remote channels or an online provider. It only executes local commands inside the Gauss workspace.

## Event learning inbox

Drop mission-event files into:

```bash
reports/lessons/inbox
```

Supported formats:

- `.json`
- `.md`
- `.txt`

Then either wait for the `offline-repair-loop` PicoClaw job or run:

```bash
npm run deposit:events:offline
```

That will:

- convert the event into a trusted lesson note under `research/documentation-rag/mission-lessons`
- append a local offline-learning example to `ml/data/event_lessons.jsonl`
- refresh the document trust manifest
- attempt to re-index local RAG if the service is available
