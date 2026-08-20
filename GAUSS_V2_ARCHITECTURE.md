# Project Gauss v2 — Ops-First Space AI Architecture
## Closed-Loop · C++ Core · Flat SQL · East/West MCP Interop · Tailscale Mesh

> **Design principle:** Visual layer is not a priority. Every decision optimises for operations, learning throughput, security, and interoperability. C++ and flat SQL where possible.

---

## Table of Contents

1. [What Changed from v1](#1-what-changed-from-v1)
2. [Zone A — Sensing: Secure Operator Dataset Sync (NEW)](#2-zone-a--sensing-secure-operator-dataset-sync)
3. [Zone B — Global Space Data MCP (NEW)](#3-zone-b--global-space-data-mcp-eastwest-interop)
4. [Zone C — Durable Buffer](#4-zone-c--durable-buffer)
5. [Zone D — C++ Physics + ML Core](#5-zone-d--c-physics--ml-core)
6. [Zone E — Flat SQL Storage](#6-zone-e--flat-sql-storage)
7. [Zone F — Tailscale Mesh: Contribute + Benefit](#7-zone-f--tailscale-mesh-every-node-contributes--benefits)
8. [Zone G — Ops Surface](#8-zone-g--ops-surface)
9. [Zone H — Closed Learning Loop](#9-zone-h--closed-learning-loop)
10. [Three-Ring Redundancy](#10-three-ring-redundancy)
11. [System Improvements](#11-system-improvements)
12. [C++ Migration Path](#12-c-migration-path)
13. [Flat SQL Schema (canonical)](#13-flat-sql-schema-canonical)
14. [MCP Tool Catalogue](#14-mcp-tool-catalogue)
15. [Security & Compliance Matrix](#15-security--compliance-matrix)

---

## 1. What Changed from v1

| Area | v1 | v2 |
|------|----|----|
| Core language | TypeScript / Node.js | **C++ (physics, ML, ingest core)** + thin Rust orchestrator |
| Storage | Supabase + in-memory | **DuckDB (analytics) + SQLite (per-node) + Supabase (auth/RLS)** |
| Model serving | MLX (Python) | **ONNX Runtime C++ + 4-bit quantised on-device** |
| Sensing | Public feeds only | + **Secure operator vault sync** (new) |
| Interop | Internal only | + **Global Space Data MCP** (East + West) |
| Mesh | Turing pool (cache/compute) | **Full gossip model sync — every node contributes and benefits** |
| Frontend | React/Three.js priority | **Ops surface only — Telegram + REST API + MCP tools** |
| Learning | Offline repair loop | + **Federated training across Turing nodes** |

---

## 2. Zone A — Sensing: Secure Operator Dataset Sync

### Problem
Operators hold sensitive mission datasets (classified orbital elements, proprietary sensor calibrations, restricted event logs) that must participate in model training and inference without ever being exposed on a public channel or to unauthorised nodes.

### Design

```
Operator device (Tailscale node)
  │
  ├─ AES-256 encryption at rest (SQLCipher / vault)
  │
  ├─ mTLS in transit (Tailscale WireGuard + app-level cert)
  │
  ├─ ZK-verified transfer
  │   └── BLAKE3 content hash committed before transfer
  │       recipient verifies hash without seeing plaintext
  │
  ├─ Operator vault (ACL-gated)
  │   ├── clearance_level: [public | restricted | secret | operator-only]
  │   ├── dataset_acl: [node_id_list]  -- only listed Turing nodes can read
  │   └── expiry_ttl: optional auto-purge
  │
  └─ Differential-privacy export
      └── Laplace mechanism (ε-DP) applied before any gradient leaves vault
          Sensitive data NEVER crosses node boundary — only DP gradients do
```

### Implementation notes

- Use **SQLCipher** (C++ AES-256 SQLite) for the vault, not a separate service.
- Sync protocol: **rsync-over-Tailscale** for bulk initial load; **delta-sync** (CRDT-based) for incremental updates.
- Access check at every read: `SELECT 1 FROM vault_acl WHERE dataset_id=? AND node_id=? AND clearance>=?`
- Flat SQL table: `operator_datasets(id, name, clearance, acl_json, hash_blake3, size_bytes, ingested_at, expires_at)`
- ZK verification: commit hash before transfer in `dataset_commits(id, hash, committed_at, committer_node_id)` — recipient runs `BLAKE3(received_bytes) = committed_hash` before accepting.

---

## 3. Zone B — Global Space Data MCP: East/West Interop

### Supported protocols and agencies

| Protocol | Agencies | Notes |
|----------|----------|-------|
| CCSDS (packet + file) | NASA, ESA, JAXA, CNSA, ISRO, Roscosmos | Primary wire format for telemetry |
| HAPI (HTTP API) | NASA/CDAWeb, ESA, JAXA | Time-series query standard |
| SPASE (XML metadata) | NASA, ESA | Provenance and dataset catalogues |
| STP (Space Telemetry Protocol) | US DoD + NATO | Encrypted real-time stream |
| XTCE (XML telemetry config) | Multi-agency standard | Parameter dictionary |
| Proprietary adapters | CNSA CAST, Roscosmos ASPOS | Thin shim over canonical schema |

### MCP server: `gauss-mcp-space-interop`

Run as a C++ stdio process (wraps the interop library) or as an HTTP server on `127.0.0.1:8095`.

```cpp
// Tool registration (C++ MCP SDK pattern)
mcp::Server server;
server.add_tool("space_query", space_query_handler);
server.add_tool("space_ingest", space_ingest_handler);
server.add_tool("space_schema_map", schema_map_handler);
server.add_tool("space_provenance", provenance_handler);
server.add_tool("space_federated_query", federated_query_handler);
server.add_tool("operator_sync_status", operator_sync_handler);
server.add_tool("rag_index", rag_index_handler);
server.add_tool("rag_query", rag_query_handler);
server.add_tool("evaluate_model", evaluate_model_handler);
server.add_tool("deploy_checkpoint", deploy_checkpoint_handler);
server.add_tool("run_training_job", training_job_handler);
```

### MCP Tool Definitions

**`space_query`** — unified time-series query across any supported agency:
```json
{
  "name": "space_query",
  "description": "Query space weather data from any supported agency/protocol",
  "inputSchema": {
    "agency": "string (noaa|esa|jaxa|cnsa|isro|roscosmos|all)",
    "parameter": "string (e.g. imf_bz, solar_wind_speed)",
    "start": "ISO8601",
    "end": "ISO8601",
    "clearance": "string (public|restricted|operator)"
  }
}
```

**`space_ingest`** — push a raw packet batch into the pipeline:
```json
{
  "name": "space_ingest",
  "description": "Ingest CCSDS/HAPI/STP packet batch, normalise to canonical flat SQL",
  "inputSchema": {
    "format": "ccsds-bin|ccsds-hex|hapi-json|stp",
    "payload_base64": "string",
    "source_agency": "string",
    "clearance": "string"
  }
}
```

**`space_federated_query`** — fan out a query to all reachable agency endpoints and merge:
```json
{
  "name": "space_federated_query",
  "description": "Fan-out query to all reachable East+West endpoints, merge and deduplicate",
  "inputSchema": {
    "parameter": "string",
    "start": "ISO8601",
    "end": "ISO8601",
    "agencies": ["noaa","esa","jaxa","cnsa"]
  }
}
```

### Schema normalisation (flat SQL canonical form)

Every agency's data lands in the same flat table — no nested JSON in hot paths:

```sql
CREATE TABLE sw_canonical (
    id            BIGINT    PRIMARY KEY,
    observed_at   TIMESTAMPTZ NOT NULL,
    source_agency TEXT      NOT NULL,   -- noaa|esa|jaxa|cnsa|isro|operator
    source_proto  TEXT      NOT NULL,   -- ccsds|hapi|stp|xtce
    parameter     TEXT      NOT NULL,   -- imf_bz | solar_wind_speed | ...
    value         DOUBLE    NOT NULL,
    unit          TEXT      NOT NULL,
    quality       SMALLINT  NOT NULL DEFAULT 0,  -- 0=unknown 1=low 2=high
    clearance     SMALLINT  NOT NULL DEFAULT 0,  -- 0=public 1=restricted 2=operator
    hash_blake3   BLOB,                 -- provenance integrity
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sw_canonical_time ON sw_canonical(observed_at DESC);
CREATE INDEX sw_canonical_param ON sw_canonical(parameter, observed_at DESC);
```

This schema is readable by DuckDB, SQLite, PostgreSQL/Supabase, and any JDBC/ODBC client — maximum interoperability.

---

## 4. Zone C — Durable Buffer

Kafka with two topic classes:

| Topic | Partitions | Replication | ACL | Purpose |
|-------|-----------|-------------|-----|---------|
| `sw.public.*` | 12 | 3 | Open read | All public agency feeds |
| `sw.operator.*` | 6 | 3 | Node ACL enforced | Encrypted operator data |
| `sw.dlq` | 3 | 3 | Operator read | Failed messages → repair inbox |

**Key settings for space telemetry:**
- `retention.ms = 604800000` (7 days — enough for offline recovery)
- `compression.type = lz4` (low CPU, good ratio for telemetry)
- `acks = all` on producer for operator topics
- Consumer checkpoint interval: 5s (matches ingest cadence)

---

## 5. Zone D — C++ Physics + ML Core

### Migration from TypeScript

| Component | Current | Target |
|-----------|---------|--------|
| `mhd-nowcast.ts` | TypeScript | `libgauss_physics.so` (C++17, Eigen3) |
| `mms-probability.ts` | TypeScript | Same library, separate compilation unit |
| `probability-gate.ts` | TypeScript | C++ with ONNX Runtime C++ API |
| `ingest-loop.ts` | TypeScript/Node | `gauss_ingest` binary (C++, librdkafka) |
| Fused model head | Python/MLX | ONNX model, C++ Runtime |
| DeepSeek inference | Python/MLX | llama.cpp (C++, GGUF 4-bit) |

### Physics library API (C++)

```cpp
namespace gauss::physics {

struct CanonicalPoint {
    double imf_bz, imf_by, imf_bt;
    double sw_speed, sw_density, sw_pressure;
    double kp, dst, dst_slope;
    double newell_coupling, akasofu_epsilon;
    double shue_r0, alfven_speed;
    double sin_clock, cos_clock;
    int64_t observed_at_unix_ms;
    uint8_t quality;   // 0=unknown 1=low 2=high
    uint8_t clearance; // 0=public 1=restricted 2=operator
};

// Always-on deterministic path — never returns error, always has a result
CanonicalPoint compute_canonical(const RawTelemetryBatch& batch);
MmsVector fuse_mms_vector(const MmsTetBatch& tet);
ThreatAssessment evaluate_threats(const CanonicalPoint&, const MmsVector&);

// Probability gate: returns true only when 3-sigma event detected
bool gate_llm_inference(const std::vector<CanonicalPoint>& window_24,
                        const GateConfig& cfg);
} // namespace gauss::physics
```

### On-device inference (C++ ONNX)

```cpp
// Fused multi-task head — runs only when gate passes
auto session = Ort::Session(env, "models/fused_head.onnx", session_opts);
auto [storm_p, aurora_q, recon_p, action_class] = session.Run(tensors);

// DeepSeek R1 1.5B — via llama.cpp C API (no Python)
llama_context* ctx = llama_new_context_with_model(model, ctx_params);
// 4-bit GGUF, ~1.1 GB RSS, 50-80 tok/s on M1
```

### Memory budget (per node, 6 GB Apollo ceiling)

| Component | RSS | Notes |
|-----------|-----|-------|
| `gauss_ingest` binary | 80 MB | C++ ingest + Kafka consumer |
| `libgauss_physics` | 40 MB | Physics + MMS, all stack-allocated |
| ONNX fused head | 120 MB | Loaded on demand |
| DeepSeek R1 1.5B GGUF | 1.1 GB | Loaded only when gate passes |
| Surya ONNX | 0.8 GB | Conditional — solar prior |
| DuckDB analytics | 400 MB | Columnar, compresses well |
| SQLite per-node | 80 MB | |
| Kafka client buffers | 200 MB | Per topic partition |
| Rust orchestrator | 50 MB | |
| **Total** | **~2.9 GB** | **3.1 GB headroom** |

---

## 6. Zone E — Flat SQL Storage

### Why DuckDB + SQLite over Supabase for hot paths

- DuckDB: **columnar**, zero-copy scan of Parquet/Arrow, excellent for time-series window analytics (`clean_raw_window`, nowcast aggregation). Runs in-process — no network hop.
- SQLite: **per-node**, works fully offline, trivial to replicate via file sync over Tailscale, supports SQLCipher for operator vault encryption.
- Supabase: retained for **auth, RLS, and cross-node sync** — not for hot-path analytics.

### Key tables (flat, no nested JSON in analytical queries)

```sql
-- Canonical time-series (DuckDB, append-only partition by day)
CREATE TABLE sw_canonical (...) -- see Zone B schema above

-- Operator vault (SQLite + SQLCipher)
CREATE TABLE operator_datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    clearance INTEGER NOT NULL, -- 0=public 1=restricted 2=operator
    acl_json TEXT NOT NULL,     -- ["node_id1","node_id2"]
    hash_blake3 TEXT NOT NULL,
    size_bytes INTEGER,
    ingested_at TEXT NOT NULL,
    expires_at TEXT
);

-- Audit trail (append-only, never update)
CREATE TABLE audit_log (
    id BIGINT PRIMARY KEY,
    event_at TIMESTAMPTZ NOT NULL,
    actor_node TEXT NOT NULL,
    action TEXT NOT NULL,       -- ingest|query|deploy|repair|train
    target TEXT,
    outcome TEXT NOT NULL,      -- ok|fail|gated
    detail_json TEXT
);

-- Model registry (flat, no JSON blobs)
CREATE TABLE model_versions (
    id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    version TEXT NOT NULL,
    onnx_path TEXT NOT NULL,
    gguf_path TEXT,
    hash_sha256 TEXT NOT NULL,
    deployed_at TIMESTAMPTZ,
    deployed_by TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);
```

### Retention policy (automated)

```sql
-- DuckDB: drop partitions older than 7 days for raw, 90 days for canonical
DELETE FROM sw_canonical WHERE observed_at < NOW() - INTERVAL '7 days'
  AND clearance = 0;  -- only public data auto-purged; operator data TTL from vault
```

---

## 7. Zone F — Tailscale Mesh: Every Node Contributes + Benefits

### Node roles (self-declared at registration)

```json
{
  "node_id": "turing-macbook-01",
  "tailscale_ip": "100.x.x.x",
  "roles": ["compute", "cache", "inference", "training"],
  "capacity": {
    "ram_gb": 16,
    "battery_pct": 82,
    "charging": true,
    "cpu_cores": 8,
    "gpu_tflops": 2.6
  },
  "swarm_mode": "balanced",
  "clearance": "operator"
}
```

### Contribution model

| Node state | Contributes | Receives |
|------------|-------------|----------|
| Charging, >80% battery | Full compute + training gradients | Full model updates |
| Charging, 50–80% | Inference + cache | Full model updates |
| Discharging, >50% | Cache reads + light inference | Delta updates only |
| Discharging, <50% | Read-only heartbeat | Emergency alerts only |
| Air-gap / offline | Local inference only | Queued for sync on reconnect |

### Gossip model sync protocol

- Transport: **Tailscale WireGuard** (already encrypted, no extra TLS overhead)
- Protocol: **CRDT-based delta sync** — nodes exchange weight deltas, not full checkpoints
- Trigger: every 30 min, or immediately after a local training batch completes
- Merge: **federated averaging** (FedAvg) — weighted by node's data contribution size
- Sensitive data constraint: **only DP gradients cross node boundaries** — raw operator datasets stay on originating node

```
Node A (has operator data)          Node B (receives update)
    │                                    │
    ├─ train locally on vault data       │
    ├─ apply ε-DP (Laplace noise)        │
    ├─ compute gradient delta            │
    └────── send delta (not data) ──────>│
                                         ├─ verify delta signature
                                         ├─ apply FedAvg merge
                                         └─ broadcast merged weights to mesh
```

### Per-node C++ inference shard

Each node runs `gauss_node_agent` (C++ binary):

```
gauss_node_agent
  ├── Register with mesh coordinator (POST /api/turing/register)
  ├── Heartbeat loop (60s, reports capacity)
  ├── Local inference server (llama.cpp HTTP, port 8088)
  ├── DuckDB local shard (analytics slice for this node's data)
  ├── SQLite vault (operator data, SQLCipher encrypted)
  └── Gossip client (sends/receives weight deltas)
```

---

## 8. Zone G — Ops Surface

Visual layer is not a priority. All operator interaction goes through:

| Surface | Tech | Purpose |
|---------|------|---------|
| Telegram bot | Rust (orchestrator) | Approvals, alerts, status queries, repair review |
| REST API | C++ (cpp-httplib) or Rust Axum | Threats, commands, audit, ingest, model ops |
| MCP tools | C++ stdio server | IDE/agent integration — RAG, eval, deploy, train |
| WebSocket | Rust Axum | Real-time telemetry stream for operator tooling |
| Satcom fallback | DTN + ISL | Emergency ops when all IP paths are down |

**Remove from critical path:** React/Three.js frontend, Vite dev server, browser-based HUD — these can be re-added as a thin consumer of the REST API when needed, but they must not block operational stability.

---

## 9. Zone H — Closed Learning Loop

The system gets better automatically and safely, even fully offline.

```
Sense (reports/*.json)
  └─> Reduce (batch ≤3 files, ≤180 lines)
        └─> Pair (model + orchestrator, frozen scope)
              └─> Plan (DeepSeek proposes diff, no shell authority)
                    └─> Validate (lint + targeted tests + build)
                          └─> Record (autonomous-evaluation.jsonl)
                                └─> Backprop capsule (work queue update)
                                      └─> Federated merge trigger (if training data grew)
                                            └─> MCP deploy checkpoint (after operator approval)
```

### Operator dataset contribution to learning

```
Operator vault (Node A)
  ├── ε-DP gradient extraction (Python or C++ skorch)
  ├── Sign gradient batch (node private key)
  └── Push to gossip mesh
        ├── All nodes apply FedAvg merge
        └── MCP retrain trigger fires after N gradient batches
              └── artifact_verify.py → model-deploy.log → SURYA_MODEL_PATH updated
```

### Event learning inbox (expanded)

Drop into `reports/lessons/inbox/`:
- `.json` / `.md` / `.txt` mission events
- `.csv` flat telemetry slices (auto-ingested to DuckDB)
- `.gguf` fine-tuned checkpoints (auto-verified, held for approval)
- `.sql` schema migrations (reviewed + applied after audit)

---

## 10. Three-Ring Redundancy

### Ring 1 — Source fallback (sensing)

```
Primary:   NOAA SWPC (real-time)
           ↓ fail
Secondary: ESA HAPI + JAXA ERG
           ↓ fail
Tertiary:  CNSA / ISRO proxy (MCP federated query)
           ↓ fail
Operator:  Vault last-good snapshot (restricted/operator clearance)
           ↓ fail
Offline:   Local DuckDB cache (last 7 days)
```

### Ring 2 — Inference fallback (ML core)

```
Primary:   Fused ONNX multi-task head (learned residual)
           ↓ fail / disagree > threshold
Secondary: Deterministic C++ MHD backbone (always correct, always available)
           ↓ (parallel output for safety check)
Tertiary:  Cached last-good result (stale flag set, operator alerted)
```

### Ring 3 — Self-heal fallback (ops)

```
Primary:   Online: orchestrator audit + backprop + auto-repair
           ↓ network down
Secondary: Offline: PicoClaw cron + DeepSeek proposal loop (air-gap safe)
           ↓ model unavailable
Tertiary:  Static rules engine (CyberTiger blocklist + hardcoded thresholds)
           + Telegram alert to operator for manual review
```

---

## 11. System Improvements

### Recommended changes (priority order)

**P1 — Immediate, highest impact**

1. **Migrate ingest loop to C++ (`gauss_ingest`)** — eliminates Node.js event loop jitter on telemetry timing. Use `librdkafka` (C++) directly. Expected latency improvement: 10–50ms per cycle.

2. **Replace in-memory state with DuckDB in-process** — `state.ts` ring buffers become DuckDB tables. Queries become SQL. No more manual cap/splice logic. `clean_raw_window` becomes a simple `DELETE WHERE observed_at < ?`.

3. **Implement operator vault** (Zone A) — unblocks contribution of sensitive datasets to federated training. Required for any government or defence operator use case.

4. **Add `space_federated_query` MCP tool** — single call fans out to all available agency endpoints. Operators and AI agents get one API instead of managing N adapters.

**P2 — Short-term**

5. **Gossip model sync** — extend Turing pool heartbeat to include gradient exchange. Every node improves the model; every node benefits. Currently nodes provide compute but don't share learning.

6. **Migrate probability gate to C++** — the 3-sigma gate is called on every canonical point. In TypeScript it adds ~2ms per call. In C++ it's ~10µs.

7. **ONNX export of fused model head** — current MLX model is Apple Silicon only. ONNX runs on any Turing node (ARM, x86, GPU, CPU).

8. **SQLCipher for operator vault** — drop-in SQLite replacement, AES-256, no service dependency.

**P3 — Structural**

9. **Split `backend/server.ts`** — as noted in ARCHITECTURE_REFINEMENTS.md, this file is too large. Target: `routes/feed.cpp`, `routes/ops.cpp`, `routes/ingest.cpp` in C++, or at minimum TypeScript route modules.

10. **Federated learning with DP** — formalise the gradient exchange protocol with Laplace ε-DP. Enables operator datasets to improve the shared model without data leaving the vault.

11. **SPASE metadata catalogue** — index all ingested datasets in a local SPASE-compatible XML catalogue. Enables interoperability with NASA/ESA dataset discovery tools.

12. **Replace Redis with DuckDB + Parquet cache layer** — Redis is an optional dependency that adds operational complexity. DuckDB's columnar format with Parquet files on disk is faster for time-series reads and requires no separate service.

### What to keep as-is

- Tailscale as the network control plane — correct choice, no change needed.
- CyberTiger rate limiting and RBAC — correct. Map to C++ middleware when server migrates.
- PicoClaw offline cron — correct. Keep as the offline repair trigger.
- 13-step adherence audit — correct. Add Zone B MCP and Zone A vault as new audit steps.
- Telegram approval flow — correct. Extend with `space_federated_query` status and vault sync approvals.

---

## 12. C++ Migration Path

Migration should be incremental — no big-bang rewrite.

| Phase | What | Language boundary |
|-------|------|-------------------|
| 0 (now) | Add `gauss_node_agent` C++ binary alongside Node.js server | Coexist — agent registers as a Turing node |
| 1 | Extract `libgauss_physics.so` from TypeScript via N-API binding | C++ physics, TypeScript caller |
| 2 | Replace ingest loop with `gauss_ingest` binary (librdkafka + libgauss_physics) | C++ ingest writes to DuckDB; Node.js reads DuckDB |
| 3 | Replace probability gate with C++ gate (called via N-API or IPC pipe) | Mixed |
| 4 | ONNX Runtime C++ for fused head inference | Pure C++ hot path |
| 5 | llama.cpp replaces MLX for DeepSeek (runs on all Turing nodes, not just M1) | C++ LLM |
| 6 | Route handlers migrate to cpp-httplib or Rust Axum | TypeScript server becomes optional thin proxy |

**Never rewrite:** Supabase auth integration (keep thin TypeScript adapter), Telegram bot (keep Rust), orchestrator (keep Rust — it's already correct).

---

## 13. Flat SQL Schema (canonical)

All tables use standard SQL types, no custom types, no JSON blobs in hot paths.

```sql
-- DuckDB: analytical time-series (partitioned by day)
CREATE TABLE sw_canonical (
    id BIGINT PRIMARY KEY, observed_at TIMESTAMPTZ NOT NULL,
    source_agency TEXT NOT NULL, source_proto TEXT NOT NULL,
    parameter TEXT NOT NULL, value DOUBLE NOT NULL, unit TEXT NOT NULL,
    quality SMALLINT NOT NULL DEFAULT 0,
    clearance SMALLINT NOT NULL DEFAULT 0,
    hash_blake3 TEXT, ingested_at TIMESTAMPTZ NOT NULL
);

-- Features for ML (flat, no nested tensors)
CREATE TABLE ml_features (
    id BIGINT PRIMARY KEY, computed_at TIMESTAMPTZ NOT NULL,
    window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
    imf_bz_mean DOUBLE, imf_bz_min DOUBLE, imf_bz_max DOUBLE,
    sw_speed_mean DOUBLE, sw_density_mean DOUBLE,
    kp DOUBLE, dst DOUBLE, dst_slope DOUBLE,
    newell_coupling DOUBLE, akasofu_epsilon DOUBLE,
    shue_r0 DOUBLE, alfven_speed DOUBLE,
    mms_recon_prob DOUBLE, mms_recon_conf DOUBLE,
    surya_flare_p24h DOUBLE, surya_storm_p DOUBLE,
    source_coverage DOUBLE, stale_ratio DOUBLE,
    clearance SMALLINT NOT NULL DEFAULT 0
);

-- Labels for training
CREATE TABLE ml_labels (
    id BIGINT PRIMARY KEY, feature_id BIGINT REFERENCES ml_features(id),
    labelled_at TIMESTAMPTZ NOT NULL, labeller TEXT NOT NULL,
    storm_tier_actual INTEGER, recon_event BOOLEAN,
    operator_action TEXT, confidence DOUBLE
);

-- Turing node registry
CREATE TABLE turing_nodes (
    node_id TEXT PRIMARY KEY, tailscale_ip TEXT NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL, last_heartbeat TIMESTAMPTZ,
    ram_gb DOUBLE, battery_pct INTEGER, charging BOOLEAN,
    cpu_cores INTEGER, gpu_tflops DOUBLE,
    clearance INTEGER NOT NULL DEFAULT 0,
    swarm_mode TEXT NOT NULL DEFAULT 'balanced',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Gradient exchange log (federated learning audit)
CREATE TABLE gradient_exchange (
    id BIGINT PRIMARY KEY, exchanged_at TIMESTAMPTZ NOT NULL,
    sender_node TEXT NOT NULL, receiver_node TEXT NOT NULL,
    model_name TEXT NOT NULL, version TEXT NOT NULL,
    delta_size_bytes INTEGER, dp_epsilon DOUBLE,
    signature TEXT NOT NULL, accepted BOOLEAN NOT NULL
);
```

---

## 14. MCP Tool Catalogue

### `gauss-mcp-space-interop` (new — Zone B)

| Tool | Description |
|------|-------------|
| `space_query` | Time-series query, any agency, any protocol |
| `space_ingest` | Push raw packets into pipeline |
| `space_schema_map` | Show canonical mapping for a given agency/parameter |
| `space_federated_query` | Fan-out to all reachable agency endpoints |
| `space_provenance` | Return BLAKE3 hash chain for a dataset |
| `operator_sync_status` | Show vault sync state for operator datasets |

### `gauss-mcp-model-ops` (extended from v1)

| Tool | Description |
|------|-------------|
| `rag_index` | Re-index RAG from `research/documentation-rag` |
| `rag_query` | Query RAG with a natural-language question |
| `rag_status` | Return chunk count and index freshness |
| `evaluate_model` | Run `context:backprop --short`, return summary |
| `deploy_checkpoint` | Verify checksum, append to model-deploy.log |
| `run_training_job` | POST to `/api/turing/compute` with job type |
| `node_capacity` | Return capacity map for all Turing nodes |
| `gradient_push` | Push DP gradient batch from operator vault |
| `federated_merge` | Trigger FedAvg merge across available nodes |

### Security constraints (both MCP servers)

- Only `127.0.0.1` or Tailscale `100.x.x.x` addresses accepted
- All tool calls append to `reports/audit/mcp-ops.log` (JSONL)
- Operator/admin clearance required for `gradient_push`, `federated_merge`, `deploy_checkpoint`

---

## 15. Security & Compliance Matrix

| Control | Implementation | Standard |
|---------|---------------|----------|
| Encryption at rest | SQLCipher AES-256 (vault), DuckDB Parquet with zstd | NIST 800-111 |
| Encryption in transit | Tailscale WireGuard + mTLS (app layer) | NIST 800-52 |
| Access control | RBAC (viewer/operator/admin) + per-dataset ACL | NIST 800-53 AC-2 |
| Data integrity | BLAKE3 hash chain on all ingested datasets | NIST 800-53 SI-7 |
| Audit trail | Append-only `audit_log` table, never updated | NIST 800-53 AU-9 |
| Differential privacy | Laplace ε-DP on gradient export | ISO 29101 |
| Rate limiting | CyberTiger daemon (per-IP, per-route) | NIST 800-53 SC-5 |
| Air-gap operation | `GAUSS_AIR_GAP=true` — all inference local | Space OPSEC |
| Power safety floor | Battery gate: `min_safe_battery_percent` | Directive |
| ZK provenance | BLAKE3 committed before transfer, verified on receipt | Custom |
| Model integrity | SHA-256 checkpoint verify before deploy | NIST 800-53 SI-7 |
