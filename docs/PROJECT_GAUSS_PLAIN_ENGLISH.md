# Project Gauss — In Plain English

**For non-coders: what this project is, what it does, and how to use it.**

---

## What Is Project Gauss?

**Project Gauss** is a **Space Situational Awareness (SSA) platform**. In simple terms, it’s a system that:

- **Watches space weather** — solar wind, radiation belts, magnetic field — using data from NOAA, NASA, and other agencies.
- **Shows it on a 3D globe** — Earth, Van Allen belts, magnetosphere, so you can see conditions in near-Earth space.
- **Supports mission operations** — dashboards, alerts, telemetry ingestion, and optional AI/chat for operators.

It’s built to run on modest hardware (e.g. an Apple M1 with 8GB RAM), with a focus on **stability, low memory use, and security** (NIST/ISO-style controls, zero-trust, no cloud dependency for core ops).

---

## The Big Picture (No Code)

Think of it in three layers:

1. **Data sources**  
   External feeds (NOAA, NASA, etc.) provide numbers: solar wind speed, magnetic field, particle flux, indices like Kp.

2. **Backend (“the brain”)**  
   A server that:
   - Fetches and checks that data
   - Caches it so the app stays responsive
   - Serves it to the web app
   - Handles auth, security (CyberTiger), telemetry ingestion, and optional AI/ML (probability gating, nowcast, chat)

3. **Frontend (“the screen”)**  
   A web app where you:
   - See a 3D view of Earth and space weather
   - Toggle layers (belts, magnetosphere, etc.)
   - View live numbers (Kp, solar wind, etc.)
   - Use dashboards, feedback, and (if enabled) chat

There’s also an optional **Rust orchestrator** for telemetry decoding and network/orchestration, and **mobile/Tailscale** options for field use.

---

## Main Concepts (Glossary)

| Term | Plain English |
|------|----------------|
| **Space weather** | Conditions in space that affect satellites and Earth: solar wind, radiation, magnetic field. |
| **Van Allen belts** | Zones of trapped radiation around Earth; the app visualizes them. |
| **Magnetosphere** | The “bubble” of Earth’s magnetic field; it gets compressed or stretched by the solar wind. |
| **Kp index** | A 0–9 scale of geomagnetic activity; higher = more stormy. |
| **Backend / API** | The server that gathers data and answers requests from the web app. |
| **Frontend** | The website you open in a browser (React + 3D). |
| **CyberTiger** | The project’s security daemon: rate limiting, blocking, audit trail. |
| **RBAC** | Role-based access: viewer, operator, admin — who can see or do what. |
| **Ingest** | Taking in telemetry (e.g. spacecraft packets) and storing/processing it. |
| **Turing pool** | Optional: other devices on your Tailscale network that can run cache/compute jobs. |

---

## How to “Use” the System (High Level)

- **As a viewer**  
  Someone gives you a URL and (if required) login. You open the app, see the 3D globe and space weather, and maybe dashboards or read-only feeds.

- **As an operator**  
  You run the stack (see “One-command start” below), open the app, log in with operator rights, and use dashboards, feedback, network/orchestrator tools, and optional chat.

- **As someone releasing**  
  You run the release checklist (`npm run release:check`), then tag a version (`npm run release:tag -- vX.Y.Z`) and deploy.

---

## One-Command Start (Easier Use)

From the project root, you can start the usual development stack with:

```bash
npm run start
```

This will:

1. Start the **frontend** (Vite) and **backend** (API proxy).
2. Start the **Gauss Brain stub** (so chat/ML endpoints respond locally without a real ML server).

**First time?** If you haven’t set up `.env` yet, use:

```bash
npm run start:safe
```

That runs a quick environment check and then starts the stack (and prompts you if something is missing).

---

## What Runs When (Automation)

- **`npm run start`** — Easiest: frontend + backend + brain stub (single command).
- **`npm run dev`** — Frontend only (for UI-only work).
- **`npm run dev:proxy`** — Backend API only.
- **`npm run dev:stack`** — Frontend + backend + brain stub (same as `start`, explicit).
- **`npm run dev:stack:full`** — Adds the Rust orchestrator (needs it built).
- **`npm run dev:battery`** — Low-power mode (slower polling, fewer features) for laptops/battery.
- **`npm run release:check`** — Automated pre-release checks (adherence, security); run before tagging.
- **`npm run progress`** / **`npm run progress:short`** — See how much of the planned work is done. Progress is gated by the full adherence audit: run **`npm run progress:short:refresh`** to run the audit first, then see the score. The **orchestrator** (when run from the workspace root) can report this via Telegram: **`/audit`** (audit + progress line) and **`/progress`** (refresh and report); with audit automation enabled, each cycle includes the progress line in the summary.
- **`npm run check:backend-env`** — Verify backend environment variables.
- **`npm run check:security-compliance`** — Security compliance check.

Automation is centralized in **npm scripts** (see `package.json`); no need to remember long commands.

---

## Where to Find Things (No Code)

- **Docs**  
  - This file: **Project Gauss in plain English.**  
  - **ARCHITECTURE.md** — Technical architecture (data flow, components).  
  - **WORKSPACE_MAP.md** — Where code lives (frontend, backend, tools).  
  - **RELEASE_CHECKLIST.md** — What to do before a release.  
  - **CYBERTIGER_COMPLIANCE_BASELINE.md** — Security/compliance mapping.

- **Config**  
  - **.env** — Your local settings (copy from `.env.example`).  
  - Supabase project — Database and auth (URLs and keys in `.env`).

- **Scripts**  
  - **scripts/release/** — Release tagging and preflight.  
  - **scripts/progress/** — Progress bar and hooks.  
  - **scripts/tailscale/** — Mobile/secure connectivity.  
  - **scripts/process/** — Start orchestrator, kill stale processes, workspace tree.

---

## Security and Compliance (Plain English)

- **Zero-trust** — Every request is checked; no implicit trust.
- **Roles** — Viewer (read), Operator (more tools), Admin (security, blocklist, etc.).
- **CyberTiger** — Limits request rates, blocks bad behavior, keeps an audit trail.
- **No cloud lock-in** — Core runs on your machine or your own network (e.g. Tailscale); no AWS/OpenAI required for core ops.
- **Secrets** — Stored in environment/config, not in code.

---

## If Something Goes Wrong

- **App won’t start**  
  - Run `npm run check:backend-env` and fix any missing or invalid variables.  
  - Ensure `.env` exists (copy from `.env.example`).

- **“Stale” or no data**  
  - Backend might be down; start it with `npm run dev:proxy` or `npm run start`.  
  - Check that `VITE_HELIO_PROXY_URL` points to your backend (e.g. `http://localhost:3001`).

- **Security / compliance**  
  - Run `npm run check:security-compliance` and follow its output.

- **Release**  
  - Run `npm run release:check` and fix any reported issues before tagging.

For deeper troubleshooting, see README.md and the docs listed above.

---

## Summary

- **Project Gauss** = space weather + 3D visualization + mission ops, built for constrained hardware and security.
- **Three layers**: data sources → backend (API, auth, ingest, optional ML) → frontend (3D + UI).
- **Easier use**: `npm run start` for a single-command dev stack.
- **More automated**: npm scripts for start, release, progress, security, and env checks; see README and this doc for the full list.
