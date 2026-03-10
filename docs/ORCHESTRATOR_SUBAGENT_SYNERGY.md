# Orchestrator–Subagent Synergy

This document describes how the **gauss-orchestrator** (Rust) and **Cursor subagents** (including **agents-project-manager**) work together via a single work-queue artifact.

## Flow

1. **Orchestrator runs** (autonomous code analysis or Telegram-triggered). When multi-agent analysis is enabled (`ORCHESTRATOR_ANALYZE_WITH_AGENTS=true`), it writes:
   - **`reports/orchestrator/work-queue.json`** – canonical machine-readable work queue (overwritten each run)
   - **`reports/orchestrator/work-queue.md`** – human-readable summary

2. **In Cursor**, when planning work or coordinating subagents, the rule **ORCHESTRATOR-SUBAGENT-SYNERGY** instructs the agent to read the work queue from that path and use it to seed the plan.

3. **agents-project-manager** uses the work queue to:
   - Sort items by severity/priority and `recommended_agent`
   - Map each item to a Cursor subagent (explore, shell, cyber-devops, ui-ux, ada-health)
   - Propose an ordered execution plan for the user to approve or adjust

## Canonical path

- **Work queue JSON:** `reports/orchestrator/work-queue.json`
- Override via env: **`ORCHESTRATOR_WORK_QUEUE_PATH`** (e.g. for different branches or CI)

## Work queue shape (JSON)

At the root:

- **`total_estimated_minutes`** – sum of all items’ conservative dev-time estimates (use for blocking dev time and roadmap planning).
- **`min_safe_battery_percent`** – default 25; never run heavy work when device battery is below this (devices = high-value assets; stakeholder demo).
- **`scheduling_buffer_minutes`** – extra minutes (e.g. 10% of total, 10–60 min) to add for reserved block; use **reserved block = total_estimated_minutes + scheduling_buffer_minutes** when planning.

Each item in `items` includes:

| Field | Description |
|-------|-------------|
| `id` | Stable issue id from the orchestrator |
| `title` | Short title (e.g. first line of description) |
| `severity` | `critical` \| `error` \| `warning` \| `info` |
| `priority` | Numeric 1–4 (higher = more urgent) |
| `estimated_minutes` | **Conservative** development time estimate in minutes (high end of band) for scheduling |
| `recommended_agent` | Cursor subagent tag: `explore` \| `shell` \| `cyber-devops` \| `ui-ux` \| `ada-health` |
| `recommended_actions` | 1–3 concrete action strings from consensus/agents |
| `file` | Path to file (from code issue) |
| `line` | Line number |
| `consensus` | One-line summary from multi-agent consensus |
| `recommended_action` | Orchestrator action (e.g. Auto-fix, Require Review) |
| `confidence` | 0.0–1.0 |
| `issue_type` | Orchestrator issue type (e.g. unused import, security concern) |

Estimates are **conservative** (high end) so you can under-promise and buffer for client meetings and context-switching.

## recommended_agent semantics

The orchestrator maps issue types and actions to Cursor subagent tags so the project-manager can delegate correctly:

| Issue / focus | recommended_agent |
|---------------|-------------------|
| Security, config compliance | `cyber-devops` |
| Unused imports, naming/style | `shell` |
| Performance, untestable paths, type mismatch, docs | `explore` |
| Missing error handling (when Require Review) | `ada-health` |
| Other | `explore` |

Keeping this mapping aligned in both the orchestrator (`gauss-orchestrator/src/code_analysis.rs`) and this doc ensures Cursor coordination stays in sync with orchestrator output.
