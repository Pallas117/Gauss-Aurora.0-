# GAUSS Orchestrator Development Guide

## Quick Start

### Prerequisites
- Rust 1.70+ (install via [rustup](https://rustup.rs/))
- macOS/Linux with standard build tools

### Setup
```bash
# Clone and navigate to orchestrator directory
cd gauss-orchestrator

# Create .env from example
cp .env.example .env

# Build the project
cargo build --release

# Run the orchestrator
cargo run --release
```

## Architecture Overview

The GAUSS Orchestrator implements a three-stage processing pipeline:

```
File System          Sensitivity            Routing Decision         Output
Monitor              Classification         & Anonymization
    ↓                    ↓                       ↓                     ↓
[CSV File] ──→ [detect_sensitive] ──→ [route_decision] ──→ [Local or Cloud]
    │               Content            Anonymize if         DeepSeek or
    │               Keywords:          cloud routing        OpenAI/Azure
    │               CLASSIFIED
    │               PROPRIETARY
    └─ .csv only
       2s debounce
```

### 1. File Watcher (`main()`)
- Monitors `ORCHESTRATOR_TELEMETRY_DIR` using `notify` crate
- Debounces rapid file changes (default 2s)
- Routes to `process_telemetry_file()` on `.csv` file creation
- Continues running on errors (fault-tolerant loop)

### 2. Sensitivity Analysis (`detect_sensitive_content()`)
- Scans file content for keyword patterns
- Returns enum: `Sensitivity { High, Low, Unknown }`
- Patterns: CLASSIFIED, PROPRIETARY (extensible)
- **Always add new patterns here first, before routing logic**

### 3. Routing Pipeline (`process_telemetry_file()`)
- Creates `TelemetryAnalysis` struct with metadata
- Branches on sensitivity classification:
  - **HIGH** → `route_to_local()` (no anonymization)
  - **LOW/UNKNOWN** → `route_to_cloud()` (with anonymization)
- Returns `RoutingDecision` with target and reasoning

### 4. Cloud Data Scrubbing (`anonymize_telemetry()`)
- Field-level transformations (idempotent and reversible)
- Mappings:
  - `Satellite_ID_*` → `Asset_*` (removes satellite identity)
  - `Lat:` → `Loc_X:` (generic location coordinate)
  - `Lon:` → `Loc_Y:` (generic location coordinate)
- Applied **only for cloud routing**, never for local

## Configuration

All settings use environment variables with `ORCHESTRATOR_*` prefix:

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `ORCHESTRATOR_TELEMETRY_DIR` | string | `./new_telemetry` | Directory to watch |
| `ORCHESTRATOR_WATCH_DEBOUNCE_MS` | u64 | `2000` | File change debounce (ms) |
| `ORCHESTRATOR_LOCAL_ENGINE_URL` | string | `http://localhost:8080/v1/chat/completions` | Local inference endpoint |
| `ORCHESTRATOR_CLOUD_ENABLED` | bool | `true` | Enable cloud routing |
| `ORCHESTRATOR_HTTP_TIMEOUT_SECONDS` | u64 | `8` | HTTP timeout (seconds) |
| `ORCHESTRATOR_DECODE_ENABLED` | bool | `false` | Enable CCSDS packet decode and ingest path |
| `ORCHESTRATOR_MIN_PARSE_RATE` | f64 | `0.9` | Min parse rate (mapped/decoded) for 90% gate |
| `ORCHESTRATOR_PHYSICS_VALIDATION` | bool | `true` | Apply physics bounds to canonical packets |
| `ORCHESTRATOR_PHYSICS_CLAMP` | bool | `true` | Clamp out-of-range values (vs reject) |
| `ORCHESTRATOR_PHYSICS_SIGMA_REJECT` | bool | `false` | Drop packets beyond 3-sigma from batch mean |
| `ORCHESTRATOR_PHYSICS_SIGMA_WINDOW` | usize | `64` | Max packets used for 3-sigma rolling window |
| `ORCHESTRATOR_REFINEMENT_API_URL` | string | (optional) | If set, POST each batch to this refine endpoint before ingest; backend returns clamped/interpolated packets |
| `ORCHESTRATOR_LANCEDB_CHECKSUM_LOG` | bool | `true` | Log SHA-256 of ingest batch for SEU/LanceDB verification |
| `ORCHESTRATOR_LANCEDB_URL` | string | (optional) | Reserved for future LanceDB integration |
| `ORCHESTRATOR_INGEST_RETRY_COUNT` | u32 | `3` | Retries for packet ingest POST on 5xx or connection error (0 = no retries) |
| `ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS` | u64 | `1000` | Base backoff in ms before first retry; exponential (base × 2^attempt) |

Load via `load_config()` at startup.

### Packet pipeline and physics refinement

When `ORCHESTRATOR_DECODE_ENABLED` is true, `.bin` / `.hex` / `.ccsds` files are processed by:

1. **Decode** — CCSDS primary header + payload (see `telemetry/ccsds.rs`, `decoder_registry.rs`).
2. **Map** — XTCE dictionary + APID map to canonical `solarWind` / `magneticField` (see `telemetry/mapping.rs`).
3. **Parse-rate gate** — `parse_rate = mapped_count / max(decoded_count, 1)`; if below `ORCHESTRATOR_MIN_PARSE_RATE` (default 0.9), the batch is still sent but reported as below threshold (Telegram + summary).
4. **Physics validation** — Bounds on speed (250–2000 km/s), density (0.01–1000), Bz (±100 nT); optional clamp or reject (see `telemetry/physics_validation.rs`).
5. **Optional refinement** — If `ORCHESTRATOR_REFINEMENT_API_URL` is set, each chunk is POSTed to the backend `POST /api/ingest/telemetry/refine`; the response packets (with server-side clamping) are used for ingest. If the refine call fails, the orchestrator falls back to the unrefined chunk and logs a warning.
6. **Ingest** — POST to `ORCHESTRATOR_INGEST_API_URL` in chunks of `ORCHESTRATOR_PACKET_MAX_BATCH`.

**LanceDB / SEU audit (data analysis layer):** When `ORCHESTRATOR_LANCEDB_CHECKSUM_LOG` is true (default), each ingest request payload is hashed with SHA-256 and logged (run_id + sha256). This supports the project directive that data retrieved from the vector database (LanceDB) must have its checksum verified before being passed to the LLM (SEU resilience). Optional `ORCHESTRATOR_LANCEDB_URL` is reserved for a future LanceDB write path; the current implementation only logs checksums for audit and downstream verification.

**Audit and compliance:** The packet pipeline does not bypass or weaken existing audit requirements (e.g. CyberTiger, RBAC, NIST AU-2/AU-6, ISO A.8.15/A.8.16). Physics validation and parse-rate gating are deterministic, in-process steps that add traceability: `PacketProcessSummary` exposes `parse_rate_pct`, `accepted_rate_pct`, `physics_adjusted_count`, `physics_rejected_count`, and `parse_rate_below_threshold` for operational review. Checksum logging supports data-integrity verification before LLM use. Ingest still goes through the same backend endpoint and network path, so any middleware (rate limit, auth, audit) remains in effect.

### Power flow and device power (M1 / low power)

To avoid power issues and memory pressure on constrained devices (e.g. Apple M1 8GB), the orchestrator and backend follow the project power directive:

- **Orchestrator**
  - **File watcher**: Uses `notify` (event-driven). The watcher thread keeps the process alive with `std::thread::park()` — a **blocking wait**, not a spin loop. No CPU is consumed while idle.
  - **Main loop**: `file_rx.recv().await` blocks until a path is received; no polling.
  - **Packet pipeline**: Decode → map → physics → (optional 3-sigma) → ingest is in-process and bounded by file size and `packet_max_batch` (default 250). No LLM in the hot path.
- **Backend (Node)**
  - The ingestion worker uses `setInterval` with a configurable cadence. For lower power, set **`POWER_SAVE_MODE=true`** or **`INGEST_POWER_PROFILE=low-power`** so the worker uses `LOW_POWER_CADENCE` (longer tick and source intervals, smaller aurora nside).
  - Avoid running heavy ML/LLM servers (e.g. DeepSeek) unless probability-gating has triggered; keep `--cache-limit-gb` low (e.g. 2.5) for mlx_lm.

If you still see high power or memory: ensure only one of orchestrator, backend ingest, and any ML server is doing heavy work at a time; increase backend tick/source cadences further; and cap batch sizes and retained state (e.g. coupling window, last N events).

### Rust zero-copy (PROJECT GAUSS directive)

For M1 8GB and MCP/telemetry hot paths, minimize heap allocations:

- **Telemetry and packet parsing:** Prefer `serde_json::from_slice` and borrowed types (`#[serde(borrow)]` or `'a` lifetimes) so deserialization does not clone large buffers.
- **High-throughput paths:** Use zero-copy deserialization where applicable; avoid unnecessary `.to_owned()` or `.clone()` on large payloads.
- **Checklist:** When adding or changing telemetry/MCP deserialization, consider `serde::Deserialize` with lifetimes or `from_slice` instead of `from_str`/owned types.

## Development Workflow

### Adding a New Sensitivity Pattern
1. Identify the keyword or pattern to detect (e.g., `"MILITARY_GRADE"`)
2. Add to `detect_sensitive_content()`:
   ```rust
   if content.contains("MILITARY_GRADE") {
       patterns.push("MILITARY_GRADE".to_string());
   }
   ```
3. Test with telemetry file containing the keyword
4. Verify routing to LOCAL engine in logs

### Adding a New Anonymization Rule
1. Identify field to mask (e.g., `"OperatorID:"`)
2. Define target mapping (e.g., `"Operator:"`)
3. Add to `anonymize_telemetry()`:
   ```rust
   .replace("OperatorID:", "Operator:")
   ```
4. Document the rationale in an inline comment
5. Test reversibility: `new_mask ≠ original && can_reverse_if_needed`

### Testing Locally

**Create test telemetry files:**
```bash
mkdir -p new_telemetry

# Low sensitivity (will route to CLOUD)
echo "Satellite_ID_001,Lat:42.5,Lon:-73.2" > new_telemetry/test_low.csv

# High sensitivity (will route to LOCAL)
echo "CLASSIFIED,Satellite_ID_002,Lat:40.1,Lon:-74.0" > new_telemetry/test_high.csv

# Complex CSV
cat > new_telemetry/test_complex.csv << EOF
Timestamp,Satellite_ID_AQUA,Lat:42.3,Lon:-71.0,DataQuality,Classification
2026-02-22T10:30:00Z,AQUA-2026,42.3,-71.0,HIGH,PROPRIETARY
2026-02-22T10:31:00Z,AQUA-2026,42.4,-71.1,HIGH,PROPRIETARY
EOF
```

**Monitor orchestrator output:**
```bash
# Terminal 1: Run orchestrator
ORCHESTRATOR_TELEMETRY_DIR=./new_telemetry cargo run --release

# Terminal 2: Monitor for specific log patterns
tail -f /tmp/orchestrator.log | grep -E "\[routing\]|\[anonymization\]"
```

**Expected output for low-sensitivity file:**
```
[telemetry-watcher] 📊 New Telemetry Detected: test_low.csv
[routing] ☁️  Sensitivity: LOW/UNKNOWN. Routing to CLOUD Strategic Layer...
[anonymization] 📝 Data scrubbed. Ready for Cloud Strategic Analysis.
[anonymization] ✓ Fields anonymized: Satellite_ID → Asset_, Lat/Lon → Loc_X/Loc_Y
```

**Expected output for high-sensitivity file:**
```
[telemetry-watcher] 📊 New Telemetry Detected: test_high.csv
[routing] 🧠 Sensitivity: HIGH. Routing to LOCAL DeepSeek...
[local-inference] ✅ Inference complete: 200
```

## Integration with Broader Gauss Aurora

### Data Flow
1. **Telemetry Sources**: External sensors/APIs feed CSV files to `ORCHESTRATOR_TELEMETRY_DIR`
2. **Orchestrator**: Routes based on sensitivity
3. **Local Path**: Direct to DeepSeek-R1-Distill-Qwen-1.5B-4bit (low-latency, private)
4. **Cloud Path**: Anonymized data to strategic layer (reasoning-heavy, cloud-based)
5. **Downstream**: Results feed to `backend/worker/ingest-loop.ts` for state updates

### Type Alignment
- `TelemetryAnalysis` ↔ Gauss `CanonicalSpaceWeatherPoint` (consider schema mapping if integrating)
- `RoutingDecision` ↔ Gauss `RoutingTarget` (local vs cloud)
- `Sensitivity` ↔ Gauss data classification levels

### Environment Variable Integration
- Orchestrator settings live in project `.env` file
- Follows Gauss Aurora naming pattern: `ORCHESTRATOR_*` and `GAUSS_*` prefixes
- Can be sourced in CI/CD pipelines alongside backend configs

## Performance Considerations

### File Watcher Debounce
- Default 2s balances responsiveness and duplicate prevention
- Lower values (e.g., 500ms) for high-frequency streams
- Higher values (e.g., 5000ms) for low-frequency, stable sources

### HTTP Timeout
- Default 8s accommodates DeepSeek inference latency
- Reduce for cloud routing (typically <3s for OpenAI)
- Increase for large payloads or slow networks

### Memory Efficiency
- Single `Client` instance reused across all requests
- No persistent buffering of processed files (stateless except for in-flight)
- Max buffer growth bounded by `notify` crate's internal queue

## Troubleshooting

### File Not Detected
- Check `ORCHESTRATOR_TELEMETRY_DIR` exists: `mkdir -p ./new_telemetry`
- Verify file extension is `.csv` (case-sensitive)
- Check file permissions: `chmod 644 file.csv`
- Try creating file from orchestrator's working directory

### Local Inference Fails
- Verify DeepSeek server running: `curl http://localhost:8080/v1/models`
- Check `ORCHESTRATOR_LOCAL_ENGINE_URL` matches server address
- Increase `ORCHESTRATOR_HTTP_TIMEOUT_SECONDS` if server is slow

### Anonymization Not Applied
- Confirm file is LOW/UNKNOWN sensitivity (check logs)
- Verify field names match exactly: `Satellite_ID_`, `Lat:`, `Lon:`
- Check `ORCHESTRATOR_CLOUD_ENABLED=true` in `.env`

### Missing Dependencies
- Run `cargo build` to install from `Cargo.lock`
- If issues persist: `cargo clean && cargo build --release`

## Future Enhancements

### Near-term
- [ ] Regex-based pattern detection (current: substring only)
- [ ] Configurable anonymization rules per deployment
- [ ] Metric export (Prometheus) for file processing rates
- [ ] Dead-letter queue for failed cloud routes

### Medium-term
- [ ] Multi-backend support (OpenAI, Azure, Anthropic routing)
- [ ] Batch processing for high-volume telemetry
- [ ] Audit trail logging (reversible anonymization mappings)
- [ ] WebSocket streaming for real-time analysis

### Long-term
- [ ] Machine learning-based sensitivity classification (vs keyword matching)
- [ ] Distributed orchestrator instances with state sync
- [ ] Policy engine for custom routing rules (YAML-based)
- [ ] Integration with Gauss Aurora's ML training pipeline

## References

- **Gauss Aurora**: `/backend/worker/ingest-loop.ts`, `/backend/state.ts`
- **Notify crate**: https://docs.rs/notify/latest/notify/
- **Tokio**: https://tokio.rs/
- **Reqwest**: https://docs.rs/reqwest/latest/reqwest/

