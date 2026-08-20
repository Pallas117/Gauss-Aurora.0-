# Memory and hardware optimization process

Project Gauss has two explicit runtime profiles:

- `judith-8gb` protects the 8 GB Apple Silicon workstation. The local browser, Vite, backend, and optional model must share a 5.8 GB system-used ceiling and a 900 MB Gauss-process RSS budget.
- `kali-backend` moves the long-lived Express backend to a Tailscale-connected Kali laptop. The generated user service uses a 768 MB V8 heap and a 1.5 GB systemd memory cgroup limit by default.
- A managed Turing edge worker on Kali uses separate 512 MB/128 MB systemd
  ceilings for cache/compute and heartbeat services, with a 32 MB total cache
  budget; remote capacity is never counted until its health and lease evidence is fresh.

The budgets are versioned in `config/resource-budgets.json`. Change a budget only when a measured hardware profile justifies it; do not use a larger limit to hide a leak.

## Repeatable optimization loop

Run this loop before and after a memory-sensitive change:

```bash
npm run memory:audit
npm run lint
npm run build
npm run memory:audit:record
git diff --check
```

For the repeatable local gate, run `npm run memory:refine`. It runs the host
audit, non-RAM inventory, focused memory/autoscaler/radiation tests, the local
two-node exchange harness, lint, build, and a post-build audit record. It then
runs the live compute-sharing audit: exit `2` means the local checks passed but
remote shared compute is not yet `READY`; it must not be reported as active.

`memory:audit` records system RAM, available RAM, CPU count, Node/npm versions, Gauss-related process RSS when the OS permits it, build output size, and the configured in-process caps. `memory:audit:record` writes the latest evidence to `reports/memory/resource-audit.latest.json`. A sandbox may report process RSS as unavailable; system and artifact checks remain useful in that case.

The refinement rule for process-local state is strict: every map, queue, cache,
dedupe window, and retained response must have an explicit capacity plus expiry,
eviction, or replacement semantics. The current examples include CyberTiger
per-IP admission state, runtime limit-signature deduplication, MMS burst-window
retention, and completed Turing work. A new store is not considered memory-safe
until a churn test demonstrates that unique inputs cannot grow it beyond its
configured bound. If a source response can be larger than the retained state,
bound the response-derived working set as well; a retention cap alone does not
make an unbounded parser safe.

External text/JSON responses now pass through `backend/runtime/bounded-response.ts`
before parsing. The TLE catalog is limited to 4 MiB per source, NOAA responses to
4 MiB, and ESA HAPI responses to 2 MiB; an oversized or invalid body is rejected
and the adapter reports failure. These are working-set ceilings, not reasons to
increase concurrency or treat a failed source as healthy.

The Turing boundary applies the same rule to remote cache and worker traffic:
cache/compute responses and cache writes are capped at 512 KiB, while health and
heal responses are capped at 64 KiB. Each edge cache also has a 32 MiB total
byte budget with FIFO eviction. This keeps a remote node from becoming an
unbounded allocation source for the backend or itself.

## Memory Systems agent

Use the repository role and portable skill `memory-systems` / `gauss-memory-systems` for any proposal that moves state out of hot RAM. Its observation-only inventory is:

```bash
python3 scripts/memory/non_ram_inventory.py --json
```

The agent distinguishes operating-system compression and swap, local SSD spill, memory-mapped/page-cached artifacts, Apple Silicon unified GPU memory, durable external storage, and remote compute. It must report `observed`, `inferred`, `unknown`, `blocked`, or `verified` for each tier. Swap and compression are pressure signals, not extra budget; Apple Silicon GPU memory is part of the same RAM budget; and remote capacity requires the application-level compute-sharing audit.

Every recommendation must include a maximum size, retention/eviction policy, sensitivity and encryption treatment, latency expectation, teardown path, rollback, and before/after measurement. The agent is not an always-on daemon and does not tune swap, mount storage, start remote work, or change network state.

For a deliberate threshold check, run:

```bash
python3 scripts/memory/resource_audit.py --profile judith-8gb --fail-on-over
```

Keep telemetry, security-event, Turing-device, approval, and WebSocket queues bounded. Prefer Supabase/Influx or another external store for history. Keep the frontend SVG/CSS-first and use the existing power profile instead of adding another always-on process.

Research evidence and the adoption matrix are maintained in
[`research/documentation-rag/papers/memory-storage-compute-optimization-peer-reviewed-2023-2025.md`](../research/documentation-rag/papers/memory-storage-compute-optimization-peer-reviewed-2023-2025.md).
The current priority is quantized immutable model artifacts, first-class KV
cache ceilings, locality-aware artifact scheduling, and content-addressed
checkpoint reuse. Paper-reported gains are hypotheses for this hardware, not
budget overrides; benchmark them on Judith, Kali, and each Turing node class.

The shared radiation-work exchange follows the same budget: at most 128
in-process jobs, 256 KiB per normalized input window, 256 MB default edge
memory requirement, one radiation lease per device per scheduler tick, and
immediate release of completed input samples. Finished records are retained in
a bounded diagnostic window of 16 by default and pruned after drains; the
summary reports retained-process-memory growth so the pipeline can be tuned
toward net-zero or net-negative growth. A node with unknown free RAM or below
the radiation battery floor is not treated as available capacity. See
[`TURING_RADIATION_WORK_EXCHANGE.md`](TURING_RADIATION_WORK_EXCHANGE.md).

Autoscaler relief is admission-controlled by the same evidence. It requires a
two-sample retained-process-memory trend that is non-positive before scale-out;
positive growth means refine/evict first, and an unknown baseline means hold.
`TURING_AUTOSCALER_MEMORY_GROWTH_TOLERANCE_MB=0` is the strict default. Remote
capacity remains unknown until the application-level compute-sharing audit is
`READY`, which requires an approved healthy node, free-memory evidence, and at
least one completed bounded lease—not merely a configured fleet pool or
reachable listener.

## Backend relocation to Kali over Tailscale

The backend deploy is separate from Turing worker onboarding. The deploy script copies backend source and package metadata, installs dependencies on Kali, writes the selected environment file with mode `0600`, and manages a user-level `gauss-backend.service`. It binds the service to the Kali machine's current Tailscale IPv4 address rather than `0.0.0.0`.

Before copying source or installing a unit, deployment performs a read-only remote
memory preflight. It requires at least `MemoryMax + 512 MB` of available RAM and
refuses to proceed when substantial swap pressure is combined with insufficient
reclaim headroom. This is intentionally not bypassed by a larger service limit;
close or resize unrelated workloads and rerun the observation first.

First validate the plan without making network changes:

```bash
npm run backend:deploy:tailscale -- \
  --ssh-target kali@100.x.y.z \
  --env-file .env \
  --dry-run
```

To query the real target without copying files or starting a service, use the
non-mutating preflight (run it as the active Kali desktop user):

```bash
npm run backend:deploy:tailscale -- \
  --ssh-target pallas117@100.107.156.105 \
  --network-only-sensitive \
  --preflight-only
```

This is the authoritative pre-deployment check for Tailscale identity, user
systemd, RAM/swap headroom, and the required mode-0600 network-only env bundle.

Then deploy from a machine with working Tailscale and SSH access:

```bash
npm run backend:deploy:tailscale -- \
  --ssh-target kali@100.x.y.z \
  --env-file .env
```

The command prints the resulting URL. Point the local frontend at it in a local, uncommitted env file:

```bash
VITE_HELIO_PROXY_URL=http://100.x.y.z:3001
```

The selected env file is transmitted separately and is never included in the release archive. The remote service requires Tailscale, Node, npm, curl, and user systemd. Log into the Kali desktop session for the first deployment; enable boot persistence once with `sudo loginctl enable-linger <kali-user>`.

If Tailscale is unavailable on the deployment machine, repair the local Tailscale client first, then verify:

```bash
tailscale ip -4
ssh kali@100.x.y.z 'tailscale ip -4 && node --version && systemctl --user show-environment >/dev/null'
```

Do not expose the backend on all interfaces, commit a real `.env`, or put a Turing registration secret in a command history. Turing device/cache onboarding remains available separately through `npm run turing:device:bootstrap`.

## Review cadence

- Every change that adds a process, queue, cache, polling loop, model, or WebSocket path must state its budget and teardown behavior.
- Every meaningful backend/UI change runs the audit before and after the change, plus the risk-based tests printed by `npm run develop:status`.
- When a measured host exceeds its budget, capture the report, identify the retaining process or queue, reduce scope, and rerun the audit. Raising the ceiling requires a durable decision in `development/memory/DECISIONS.md`.
