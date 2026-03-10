# Using the orchestrator to test for bugs and refine

The Gauss Orchestrator can run **autonomous code analysis** over the codebase: it indexes code, detects issues (e.g. missing error handling, unused imports, untestable paths), optionally routes them to the multi-agent system for recommendations, and can apply fixes with validation.

## Quick: run analysis and see the report

From the repo root:

```bash
npm run test:orchestrator:analyze
```

This runs the **code analyzer demo** inside `gauss-orchestrator`:

1. **Index** – scans `gauss-orchestrator/src` for symbols, coverage, and structure.
2. **Analyze** – finds issues (Critical / Error / Warning / Info).
3. **Multi-agent** – shows how issues would be routed (Reasoning, CodeGen, SafetyCheck, etc.).
4. **Fixing** – reports how many are auto-fixable and simulates validation.
5. **Report** – prints a summary you can use to refine code.

Output includes file/line for each issue and severity so you can fix or refine by hand or follow up with the multi-agent pipeline.

## Run orchestrator tests (unit + integration)

To run the full orchestrator test suite (no analysis, just tests):

```bash
npm run test:orchestrator
```

This runs `cargo test --all-targets` in `gauss-orchestrator` (unit, integration, property-based).

## Full pipeline with multi-agent and Telegram

To run the **live** orchestrator with analysis at startup and optional multi-agent + Telegram reporting:

1. Build the orchestrator:  
   `cd gauss-orchestrator && cargo build --release`

2. Set env and run (from repo root or `gauss-orchestrator`):
   - `ORCHESTRATOR_ANALYZE_AT_STARTUP=true` – run code analysis once on startup.
   - `ORCHESTRATOR_ANALYZE_WITH_AGENTS=true` – route issues to the multi-agent system (needs local/cloud model configured).
   - Telegram (optional): `ORCHESTRATOR_TELEGRAM_BOT_TOKEN` and `ORCHESTRATOR_TELEGRAM_CHAT_ID` to send the report to the ADA bot.

3. Start it:  
   `npm run dev:orchestrator`  
   (or run the binary directly from `gauss-orchestrator`.)

With the local chat engine on 8089 (or your MLX server), the orchestrator can use it for agent analysis when `ORCHESTRATOR_ANALYZE_WITH_AGENTS=true`.

## Summary

| Goal                         | Command                          |
|-----------------------------|-----------------------------------|
| Test for bugs + get report  | `npm run test:orchestrator:analyze` |
| Run orchestrator test suite| `npm run test:orchestrator`       |
| Run orchestrator with analysis at startup | `ORCHESTRATOR_ANALYZE_AT_STARTUP=true npm run dev:orchestrator` |

See [gauss-orchestrator/AUTONOMOUS_CODE_ANALYSIS.md](../gauss-orchestrator/AUTONOMOUS_CODE_ANALYSIS.md) for the full pipeline (indexing, analysis, fixing, Telegram).
