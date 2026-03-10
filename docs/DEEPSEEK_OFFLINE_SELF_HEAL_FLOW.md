# DeepSeek Offline Self-Heal Flow

This flow is the safe way to let the local DeepSeek path begin fixing Gauss offline.

The constraint is deliberate: DeepSeek should not receive broad shell authority or an unbounded repo context. It should operate on a reduced local repair capsule, propose a small diff, and pass local validators before any apply step.

## Current debt that blocks autonomous repair

1. `backend/server.ts` is still the dominant backend hotspot and mixes routing, planner logic, runtime state, and startup.
2. `backend/worker/ingest-loop.ts` still owns too many concerns at once: cadence, persistence, source policy, and runtime observation.
3. `src/pages/HeliophysicsDashboard.tsx` and `src/pages/AutomationPage.tsx` are large operator surfaces that still carry rendering and control logic together.
4. The current DeepSeek safe runner is command-oriented diagnostics, not a bounded patch lane. It can validate safe shell commands, but it does not yet own a patch proposal lifecycle.
5. `reports/orchestrator/work-queue.json` can exist in a reduced debug form, so it is not enough by itself to drive patch selection.

## Required control plane

Use a six-stage loop:

1. `Sense`
   - Inputs:
     - `reports/progress/requirements-audit.latest.json`
     - `reports/progress/backend-lint-issues.json`
     - `reports/context/latest-backprop.json`
     - `reports/orchestrator/work-queue.json`
   - Output:
     - `reports/orchestrator/offline-repair-capsule.latest.json`

2. `Reduce`
   - Convert raw debt into small offline-fixable batches.
   - Drop anything that needs credentials, network access, package installation, or broad repo churn.
   - Hard cap each batch:
     - max `3` files
     - max `180` changed lines

3. `Pair`
   - Freeze the batch into two lanes:
     - `model`: bounded patch reasoning only
     - `orchestrator`: scope enforcement, validators, recording
   - The model does not get shell authority.
   - The orchestrator does not widen scope after pairing is frozen.

4. `Plan`
   - DeepSeek runs only against the local repair capsule.
   - It returns:
     - JSON repair summary
     - unified diff
     - validator plan
   - It does not get raw shell freedom.

5. `Validate`
   - Run only local validators:
     - `npm run -s lint`
     - targeted tests
     - `npm run -s build` when frontend is touched
   - Any failure closes the batch immediately.

6. `Record`
   - Append the outcome to `reports/context/autonomous-evaluation.jsonl`
   - Refresh backprop and the next repair capsule
   - Keep human approval for medium/high-risk apply

## Why this works offline

- `GAUSS_AIR_GAP=true` and `ORCHESTRATOR_STRICT_LOCAL_INFERENCE=true` keep planning local.
- `ORCHESTRATOR_LOCAL_ENGINE_URL` or `GAUSS_BRAIN_URL` points to MLX or the local stub.
- Audits, work queue, backprop, and hotspot scans are already local artifacts.
- Validation stays on-host and does not depend on cloud inference.

## New artifact

Run:

```bash
npm run repair:offline:capsule
npm run repair:offline:pairing
```

This writes:

- `reports/orchestrator/offline-repair-capsule.latest.json`
- `reports/orchestrator/offline-repair-pairing.latest.json`

The capsule remains the bounded prompt substrate for an offline DeepSeek repair pass. The pairing artifact makes the next tech-debt batch explicit for the model/orchestrator pair.

## Recommended execution policy

DeepSeek should begin in `proposal-only` mode:

1. Generate one batch diff.
2. Validate locally.
3. Store the patch and verdict.
4. Require operator approval before apply.

After repeated green runs, only `P3` low-risk batches should be eligible for auto-apply.

## Current ops surface

- `POST /api/ops/repair/offline/pairing`
  - returns the active batch, pairing contract, and queue summary
- `POST /api/ops/repair/offline/plan`
  - uses the pairing contract in the planner prompt and records it in the patch artifact

## Next engineering step

Wire a dedicated offline repair endpoint or orchestrator task that:

1. reads `offline-repair-capsule.latest.json`
2. reads or derives the model/orchestrator pairing for the first repair batch
3. calls the local DeepSeek planner
4. writes a patch artifact under `reports/orchestrator/repair-patches/`
5. runs the listed validators
6. appends an evaluation line

That is the correct bridge between today's local planner and a real offline self-healing loop.
