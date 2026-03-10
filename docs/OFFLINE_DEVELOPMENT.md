# Offline development (no MLX, no network)

To develop without the internet or without running the MLX model, use the **stub** on port **8089**.

## Air-gapped (no external internet)

Set:

```
GAUSS_AIR_GAP=true
```

When enabled, the backend ingestion worker **does not call external adapters** (NOAA/ESA/JAXA/MMS/SSA providers). The backend continues to emit canonical outputs using last-known state + safe defaults, and marks source status as `disabled: air-gapped`.

## 1. Point .env at the stub (port 8089)

In your `.env` set:

```
GAUSS_BRAIN_URL=http://127.0.0.1:8089/v1
ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8089/v1/chat/completions
```

## 2. Start the stack

- **Frontend + API + stub:** `npm run dev:stack`
- **+ orchestrator:** `npm run dev:stack:full`

The stub runs on 8089 and is started by these scripts. No MLX, no network.

## One-command offline (no .env edit)

- `npm run dev:offline` — frontend, API, stub (env forced to 8089)
- `npm run dev:offline:full` — same + orchestrator

## If you use MLX (port 8088)

Run `npm run dev:brain:mlx` and keep .env on 8088. Otherwise leave .env on **8089** so the stub is used and the local model works offline.
