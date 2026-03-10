# Full Backpropagation Runbook

This runbook defines the **full backpropagation** cycle: refresh audit and build the context capsule, then a 1-hour reflection block, then record learnings for the Development Evaluation.

## 1. Run full backpropagation

From the repo root:

```bash
npm run backprop:full
```

This runs in order, **unless battery is below the safe floor** (see below):

1. **`audit:adherence:record`** — Full adherence audit; writes `reports/progress/requirements-audit.latest.json`. When battery is low, this step is skipped and the capsule uses existing (or stale) audit evidence.
2. **`context:backprop`** — Builds the backprop context capsule from progress checker output, git worktree, routes/endpoints, and (if present) the last line of **`reports/context/autonomous-evaluation.jsonl`**; writes `reports/context/latest-backprop.json` and `reports/context/latest-backprop.md` (plus timestamped copies).

**Battery behavior:** The backprop driver reads `min_safe_battery_percent` from `reports/orchestrator/work-queue.json` (default 25) and current battery from `BATTERY_PERCENT` or `pmset -g batt` on macOS. If battery is below that floor, only `context:backprop` runs (no audit refresh). The progress checker will use whatever `requirements-audit.latest.json` exists, or report audit missing. Use `npm run backprop:full -- --no-battery-check` to force full audit (e.g. when plugged in or in CI).

**Autonomous runs:** When the orchestrator runs the small-batch patch loop (after the fix phase), it runs `context:backprop` after each batch and appends one JSON line to `reports/context/autonomous-evaluation.jsonl` (issues attempted/fixed, progress before/after). The backprop scaffold reads the last line and adds a one-line summary to the capsule (e.g. "Last autonomous run: K patches, progress X% -> Y%").

You now have an up-to-date capsule and readiness snapshot.

## 2. One-hour reflection block

After running full backprop, **block 1 hour** to review the capsule and reflect. No code execution during this block.

- Open **`reports/context/latest-backprop.md`** (and optionally `latest-backprop.json`).
- Use the prompts in **[reports/context/reflection-template.md](../reports/context/reflection-template.md)** to structure your reflection.

At the end of the hour, create a timestamped learnings file so the evaluation can incorporate them.

## 3. Record learnings

Create a learnings file from your reflection:

- **Path:** `reports/context/YYYY-MM-DD-learnings.md` (use today’s date).
- **Include:**
  - Date and which backprop run this follows (e.g. “After `latest-backprop.md` from &lt;generated_at&gt;”).
  - Bullet or short narrative learnings from the reflection template (what to address next, what worked, what to change, what to update in the evaluation).

See [DEVELOPMENT_EVALUATION.md](DEVELOPMENT_EVALUATION.md) for how these learnings feed into improvement actions and candidates for cut.

## Orchestrator-driven backprop

When battery is sufficient, you can run the test sweep then backprop: `npm run test:sweep` (which already skips heavy UI when battery is low) and then `npm run backprop:full`. The battery-aware `backprop:full` is the single entry point: it is safe to run anytime—at low battery it skips the audit and still produces a capsule from existing evidence.

## Summary

| Step | Action |
|------|--------|
| 1 | `npm run backprop:full` |
| 2 | Block 1 hour; review capsule and [reflection-template.md](../reports/context/reflection-template.md). |
| 3 | Create `reports/context/YYYY-MM-DD-learnings.md` with your learnings |
