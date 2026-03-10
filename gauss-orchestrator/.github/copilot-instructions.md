# GAUSS Orchestrator: AI Agent Guidelines

## Project Overview
**GAUSS Orchestrator** is a high-performance, low-RAM automation engine written in **Rust** that replaces n8n with a native file-watching, sensitivity-aware routing system. It monitors telemetry files and intelligently routes them to appropriate processing pipelines based on sensitivity classification.

**Core Architecture:**
- **File Watcher**: Monitors `ORCHESTRATOR_TELEMETRY_DIR` for new `.csv` files (configurable 2-second debounce)
- **Sensitivity Detection**: Classifies telemetry content as HIGH/LOW/UNKNOWN using keyword patterns
- **Triad Routing**: Routes based on classification
  - HIGH sensitivity → **Local DeepSeek** (DeepSeek-R1-Distill-Qwen-1.5B-4bit via local HTTP)
  - LOW/UNKNOWN sensitivity → **Cloud Strategic Layer** (prepared for OpenAI/other providers)
- **Sovereign Buffer**: Privacy-first field-level anonymization (Satellite_ID → Asset, Lat/Lon → Loc_X/Loc_Y)

## Alignment with Gauss Aurora Patterns

### Configuration & Environment Variables
The orchestrator follows Gauss Aurora's environment variable patterns:
- **Namespace**: Use `ORCHESTRATOR_*` prefix (aligns with project's `GAUSS_*`, `CYBERTIGER_*`, `VITE_*` patterns)
- **Naming**: `SETTING_NAME` in UPPERCASE_WITH_UNDERSCORES
- **Load Pattern**: `std::env::var()` with sensible defaults, not hardcoded

**Key settings:**
```
ORCHESTRATOR_LOCAL_ENGINE_URL="http://localhost:8080/v1/chat/completions"
ORCHESTRATOR_TELEMETRY_DIR="./new_telemetry"
ORCHESTRATOR_WATCH_DEBOUNCE_MS=2000
ORCHESTRATOR_CLOUD_ENABLED=true
ORCHESTRATOR_HTTP_TIMEOUT_SECONDS=8
```

### Naming Conventions

#### Functions
- **Pattern**: Verb-first (action) or descriptive accessor naming (matches Gauss Aurora's `fetchNoaaReadout`, `getLatestCanonical`, `evaluateInferenceUrgency`)
- **Current implementation**:
  - `detect_sensitive_content()` - Classifies telemetry sensitivity
  - `anonymize_telemetry()` - Removes/redacts sensitive fields
  - `route_to_local()` - Sends high-sensitivity data to local inference
  - `route_to_cloud()` - Sends low-sensitivity anonymized data to cloud

#### Types & Data Structures
- **Pattern**: Semantic suffixes like `Analysis`, `Decision`, `Config`, `Status`, `Target`
- **Current implementation**:
  ```rust
  pub enum Sensitivity { High, Low, Unknown }
  pub enum RoutingTarget { Local, Cloud }
  pub struct TelemetryAnalysis { timestamp, sensitivity, detected_patterns, file_name }
  pub struct RoutingDecision { target, reason, anonymized }
  pub struct OrchestratorConfig { ... }
  ```

#### Logging
- **Pattern**: Context-prefixed emoji-based logs matching Gauss Aurora's style
- **Format**: `[module_name] emoji message`
- **Examples**:
  ```rust
  println!("[orchestrator] 🛰️  GAUSS ORCHESTRATOR: Native Rust Loop Active");
  println!("[telemetry-watcher] 📊 New Telemetry Detected: {}", file_name);
  println!("[routing] 🧠 Sensitivity: HIGH. Routing to LOCAL DeepSeek...");
  println!("[anonymization] ✓ Fields anonymized: Satellite_ID → Asset_, Lat/Lon → Loc_X/Loc_Y");
  ```

### Type System & Data Flow

**Sensitivity Classification** (centralized in `detect_sensitive_content()`)
- Returns tuple: `(Sensitivity, Vec<String>)` containing classification and detected patterns
- Keeps detection logic decoupled from routing

**Processing Pipeline** (modular):
1. File detected → `process_telemetry_file()`
2. Analyze → `detect_sensitive_content()` → `TelemetryAnalysis`
3. Route → `route_to_local()` or `route_to_cloud()` → `RoutingDecision`
4. Return analysis + decision for downstream handling

**Anonymization** (idempotent)
- Field mappings are reversible for audit trails if needed
- Applied only when routing to cloud
- Document transformation rationale in code comments

### Error Handling & Resilience

**Pattern**: Fallback behavior inspired by Gauss Aurora's ML client:
- Service failures don't crash the orchestrator
- Errors logged with context `[module] ❌ Error message`
- Cloud routing fails gracefully if disabled or network unavailable
- Local routing errors are re-raised (critical path)

**Current implementation**:
```rust
match process_telemetry_file(...).await {
    Ok((analysis, decision)) => { /* handle success */ }
    Err(e) => { eprintln!("[orchestrator] ❌ Error: {}", e); /* continue watching */ }
}
```

### Async/Concurrency

- **Runtime**: `#[tokio::main]` for async main function
- **Timeouts**: Explicit `Duration::from_secs(config.http_timeout_seconds)` on all HTTP calls
- **Client reuse**: Single `reqwest::Client` instance across all routing decisions

## Critical Implementation Notes

### Sensitivity Detection
The `detect_sensitive_content()` function uses keyword matching. Consider regex enhancement for production:
- Current: Simple substring matching (`contains("CLASSIFIED")`)
- Future: Regex patterns for military-grade TLE detection, proprietary signatures, etc.
- **Always add patterns to `detect_sensitive_content()` before routing logic references them**

### Data Anonymization
Field-level mappings in `anonymize_telemetry()`:
```rust
Satellite_ID_* → Asset_*  // removes specific satellite identity
Lat: → Loc_X:            // generic X coordinate
Lon: → Loc_Y:            // generic Y coordinate
```
- Keep transformations **idempotent** (safe to apply multiple times)
- Document mapping rationale in inline comments
- Maintain **reversibility** for audit trails if needed
- **Only applied for cloud routing** (local routes skip anonymization)

### Configuration Loading
Environment variables are loaded once at startup via `load_config()`:
- Sensible defaults match hardcoded values from original implementation
- Type conversions (.parse::<u64>()) with fallbacks
- Boolean flags: "true"/"false" strings (matches Gauss Aurora convention)

## Development Workflow

**Build:**
```bash
cargo build --release
```

**Run:**
```bash
ORCHESTRATOR_TELEMETRY_DIR=./new_telemetry cargo run --release
```

**Test with sample telemetry:**
```bash
mkdir -p new_telemetry
echo "Satellite_ID_001,Lat:42.5,Lon:-73.2" > new_telemetry/test_low_sensitivity.csv
echo "CLASSIFIED,Satellite_ID_002,Lat:40.1,Lon:-74.0" > new_telemetry/test_high_sensitivity.csv
```

**Monitor output:**
- Watch for "[telemetry-watcher] 📊" for new file detection
- Watch for "[routing] 🧠" (HIGH) or "[routing] ☁️" (LOW/UNKNOWN) for routing decisions
- Watch for "[anonymization] ✓" to verify field masking

## Extending the Orchestrator

### Adding New Sensitivity Patterns
1. Update `detect_sensitive_content()` with new keyword or regex:
   ```rust
   if content.contains("MILITARY_DESIGNATION") {
       patterns.push("MILITARY_DESIGNATION".to_string());
   }
   ```
2. Patterns automatically trigger HIGH sensitivity routing

### Adding New Anonymization Rules
1. Update `anonymize_telemetry()` with new field mapping:
   ```rust
   .replace("SatelliteAltitude:", "Altitude:")
   .replace("InclinationDegrees:", "Inclination:")
   ```
2. Document mapping rationale in inline comment
3. Test reversibility if audit trails needed

### Integrating New Cloud Providers
1. Create new routing function following `route_to_cloud()` pattern:
   ```rust
   async fn route_to_azure(...) -> Result<RoutingDecision> { ... }
   ```
2. Add conditional routing logic in `process_telemetry_file()`
3. Add environment variable for provider API key/endpoint

## Key Dependencies
- `notify`: File system watching with configurable debounce
- `tokio`: Async runtime and spawn/join task management
- `reqwest`: HTTP client with built-in timeout support
- `serde_json`: JSON serialization for inference payloads
- `chrono`: Timestamp generation (optional, can be removed)

