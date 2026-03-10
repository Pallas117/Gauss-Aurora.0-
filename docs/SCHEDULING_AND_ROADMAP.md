# Scheduling and Roadmap Using Work-Queue Estimates

Use the orchestrator work queue’s **conservative** time estimates to block dev time, plan the roadmap, and balance client meetings with development.

## Where the estimates come from

After an orchestrator run with multi-agent analysis (`ORCHESTRATOR_ANALYZE_WITH_AGENTS=true`), the work queue is written to:

- **`reports/orchestrator/work-queue.json`** – each item has **`estimated_minutes`**; the root has **`total_estimated_minutes`**
- **`reports/orchestrator/work-queue.md`** – human-readable list with "Est. N min" per item and "Total estimated (conservative): X min (Yh Zm)" at the top

Estimates are **conservative** (high end of a band by issue type and severity) so you can under-promise and leave buffer for meetings and interruptions.

## How to use the estimates

1. **Reserve dev blocks**  
   Use **`total_estimated_minutes`** (or the sum of **`estimated_minutes`** in the queue) to decide how much time to block for this batch. Example: "This batch ≈ 2.5 h; block 3 h to include buffer."

2. **Order and split work**  
   Use per-item **`estimated_minutes`** to order tasks (e.g. quick wins first) or split across days (e.g. "Do the 25-min items today; leave the 60-min security item for a focused block tomorrow").

3. **Balance with client work**  
   Treat the total as **minimum reserved time** for development. Add extra buffer for meetings, reviews, and context-switching so you can meet clients and still deliver.

4. **Roadmap and project-manager**  
   When the project-manager (or Cursor rule) proposes a plan, it will include **Conservative total: X min**. Paste that into your calendar or roadmap so scheduling stays aligned with the same numbers.

## Conservative rule

- **Estimates = minimum reserved time.** Add buffer on top for meetings, reviews, and interruptions.
- Use the same **total_estimated_minutes** in roadmap and calendar so client commitments and dev blocks stay consistent.

---

## Device power safety and buffer (high-value assets)

Treat every device on the Gauss network as a **high-value satellite**—especially during the initial testing and demonstration phase for stakeholders.

### 25% minimum battery rule

- **Never** run heavy work (orchestrator multi-agent analysis, MLX/LLM, long ingest batches) when device battery is **below 25%**.
- This keeps devices safe, avoids unexpected shutdowns during demos, and preserves capacity for client meetings.
- The work queue reports **`min_safe_battery_percent`** (default 25) so tooling and the project-manager can enforce the rule.

### Scheduling buffer and reserved block

- The work queue includes **`scheduling_buffer_minutes`** (e.g. 10% of total, clamped 10–60 min).
- **Reserved block** = `total_estimated_minutes` + `scheduling_buffer_minutes`. Use this when blocking calendar time so there is built-in delay for context-switching and meetings.
- In **work-queue.md**, the header shows both the total estimate and the reserved block with buffer.

### Learning CPU, GPU, and power flow (future)

- The system is designed to **learn** CPU, GPU, and power-flow patterns over time and adapt:
  - Prefer running heavy analysis when the device is plugged in or battery is high.
  - Defer or throttle when battery is low or when historical patterns show high drain.
- Initial phase: the **policy** (25% floor, buffer) is fixed; pattern learning and adaptive scheduling can be added later (e.g. from powermetrics or backend telemetry) so reserved blocks and deferral become data-driven.
