# DeepSeek Integration Guide

This document describes how the GAUSS Orchestrator uses DeepSeek as the local inference engine and **mission operator / decision-maker** for analyzing telemetry and producing mission decisions.

## Overview

The orchestrator treats **DeepSeek as the operator we are training**: the model is the decision-maker. It routes HIGH-sensitivity telemetry to DeepSeek for on-premise or API-based analysis; the model is prompted to output a mission decision (NOMINAL / MONITOR / INITIATE SHIELDING) and rationale. That decision is stored as the last operator decision and notified (e.g. Telegram). LOW/UNKNOWN sensitivity data is anonymized and may be sent to the local engine (same operator) or cloud.

**Offline / local model only:** By default the orchestrator uses only the local engine (default URL `http://127.0.0.1:8089/v1/chat/completions`) and has cloud routing disabled (`ORCHESTRATOR_CLOUD_ENABLED=false`). With no env vars set, run your MLX DeepSeek server or the gauss-brain-stub on port 8089 and the stack runs without any other model. All telemetry (HIGH and LOW/UNKNOWN) is sent to the local engine as the operator. See [Testing your MLX DeepSeek server](#testing-your-mlx-deepseek-server) and the "Offline / local model only" section in `.env.example`.

## Configuration

### Environment Variables

Set the following environment variables to configure DeepSeek integration. **For local MLX only, you can leave API keys unset and set only the local engine URL.**

```bash
# Local engine: MLX server, stub, or cloud DeepSeek (default: http://127.0.0.1:8089/v1/chat/completions)
export ORCHESTRATOR_LOCAL_ENGINE_URL="http://localhost:8080/v1/chat/completions"

# DeepSeek API key (required for cloud DeepSeek; leave unset for local MLX/stub)
export ORCHESTRATOR_LOCAL_ENGINE_API_KEY="your-deepseek-api-key"

# Set to true only if you want LOW/UNKNOWN telemetry sent to OpenAI (default: false for offline-only)
export ORCHESTRATOR_CLOUD_ENABLED=false

### Alternative: Using DEEPSEEK_API_KEY

If you prefer, you can set the API key using the standard DeepSeek environment variable:

```bash
export DEEPSEEK_API_KEY="your-deepseek-api-key"
```

The orchestrator checks both `ORCHESTRATOR_LOCAL_ENGINE_API_KEY` and `DEEPSEEK_API_KEY` (in that order) for flexibility.

## Routing Flow

```
Telemetry File Detected
        ↓
Analyze Content
        ↓
    ┌─────────────────────────┐
    │  Sensitivity Detection  │
    └─────────────────────────┘
        ↓              ↓
    HIGH           LOW/UNKNOWN
      ↓                ↓
  DeepSeek         Anonymize
  (Operator /         ↓
   Decision-Maker)  Local or Cloud
      ↓
  Decision (NOMINAL / MONITOR / INITIATE SHIELDING)
  → Stored + notified
```

### HIGH-Sensitivity Routing to DeepSeek (Operator)

When HIGH-sensitivity patterns are detected (e.g., "CLASSIFIED", "MILITARY"), the telemetry is sent to DeepSeek. The model is prompted **as the mission operator (decision-maker)** and asked to output one of NOMINAL, MONITOR, or INITIATE SHIELDING plus a one-line rationale.

**Request:** The orchestrator sends a system message framing DeepSeek as the Gauss mission operator using spacecraft operations procedures and probability-based reasoning, and a user message with the telemetry. The response is parsed and stored as the last operator decision; Telegram is notified with "Operator decision (DeepSeek): ...".

**Authentication:** Bearer token using the API key (optional for local MLX).

**Response:** DeepSeek returns the decision text; the orchestrator stores it in state (`get_last_operator_decision`) and notifies the operator feed.

### LOW/UNKNOWN-Sensitivity Routing to Cloud

When LOW or UNKNOWN sensitivity is detected, the orchestrator:
1. **Anonymizes** sensitive fields:
   - `Satellite_ID_*` → `Asset_*`
   - `Lat:` → `Loc_X:`
   - `Lon:` → `Loc_Y:`
2. **Routes** to OpenAI (if `OPENAI_API_KEY` is set) or queues for cloud analysis

## Usage Example

### Run with DeepSeek API Key

```bash
export ORCHESTRATOR_LOCAL_ENGINE_API_KEY="your-deepseek-api-key"
export ORCHESTRATOR_TELEMETRY_DIR="./new_telemetry"
cargo run --release
```

### Create Test Telemetry Files

```bash
mkdir -p new_telemetry

# HIGH-sensitivity file (will route to DeepSeek)
echo "CLASSIFIED,Satellite_ID_001,Lat:42.5,Lon:-73.2,Status:ACTIVE" > new_telemetry/high_sensitivity.csv

# LOW-sensitivity file (will route to cloud/anonymized)
echo "Satellite_ID_002,Lat:40.1,Lon:-74.0,Status:NOMINAL" > new_telemetry/low_sensitivity.csv
```

### Monitor Output

Watch for routing logs:

```
[routing] 🧠 Sensitivity: HIGH. Routing to LOCAL DeepSeek...
[routing] ☁️  Sensitivity: LOW/UNKNOWN. Routing to CLOUD (anonymized)...
```

## Models

### DeepSeek Models Supported

- **`deepseek-reasoner`** (default): Full-reasoning model for complex telemetry analysis
- **`deepseek-chat`**: Faster alternative for standard queries

Switch models by modifying `src/routing.rs`:

```rust
let payload = json!({
    "model": "deepseek-chat",  // Changed from deepseek-reasoner
    // ... rest of payload
});
```

## Security Considerations

### API Key Management

- **Never commit** the API key to version control
- Use environment variables for all secrets
- Rotate keys regularly
- Consider using a secrets management tool (HashiCorp Vault, AWS Secrets Manager, etc.)

### Data Sensitivity

- **HIGH-sensitive data** is sent to DeepSeek in plaintext (no anonymization)
- **LOW-sensitive data** is anonymized before cloud routing
- LOCAL routing (DeepSeek) does NOT anonymize by design (trusted local inference)

### Network Security

- All DeepSeek API calls use HTTPS (TLS 1.2+)
- Requests include API key in `Authorization: Bearer` header
- Connection timeouts prevent hanging requests (default: 8 seconds)

## Monitoring & Logging

### Structured Logging

All routing decisions are logged as structured JSON:

```json
{
  "timestamp": "2026-02-23T10:30:45Z",
  "level": "INFO",
  "message": "routing to local engine (HIGH sensitivity)",
  "module": "routing",
  "file": "test_high_sensitivity.csv"
}
```

### Enable Detailed Logging

```bash
RUST_LOG=debug cargo run --release
```

### Telegram Notifications

If Telegram is configured, routing events trigger notifications:

```
🧠 HIGH Sensitivity Detected
File: test_high_sensitivity.csv
Action: Routing to DeepSeek (Local Engine)
```

## Troubleshooting

### DeepSeek API Errors

**401 Unauthorized**
- Check API key is correct: `echo $ORCHESTRATOR_LOCAL_ENGINE_API_KEY`
- Verify key is not expired or revoked

**429 Rate Limited**
- DeepSeek enforces request rate limits
- Increase `ORCHESTRATOR_HTTP_TIMEOUT_SECONDS` to allow retries
- Space out telemetry file submissions

**503 Service Unavailable**
- DeepSeek API may be temporarily down
- Orchestrator logs warning and continues watching for new files
- No telemetry is lost (files remain in watch directory)

### Connection Timeouts

If DeepSeek requests timeout:

```bash
# Increase timeout to 30 seconds
export ORCHESTRATOR_HTTP_TIMEOUT_SECONDS=30
cargo run --release
```

### No API Key Configured

If `ORCHESTRATOR_LOCAL_ENGINE_API_KEY` is not set, the orchestrator will:
- Attempt to connect to the local engine URL without authentication
- Fail gracefully and log a warning
- Continue processing LOW-sensitivity telemetry via cloud routing

**Fix**: Set the API key in your environment

```bash
export ORCHESTRATOR_LOCAL_ENGINE_API_KEY="your-deepseek-api-key"
```

## Integration Tests

The orchestrator includes integration tests for local routing:

```bash
# Run local routing test (mocked)
cargo test route_to_local

# Run with actual DeepSeek API (requires API key and network)
ORCHESTRATOR_LOCAL_ENGINE_API_KEY="sk-..." cargo test --test integration_cloud_local
```

### Testing your MLX DeepSeek server

If you run DeepSeek locally with MLX (e.g. via mlx-llm-server), you can verify it works with the same contract used by the orchestrator and full-stack-mission:

1. Set `ORCHESTRATOR_LOCAL_ENGINE_URL` to your server’s chat completions URL (e.g. `http://localhost:8080/v1/chat/completions`).
2. Optionally set `ORCHESTRATOR_CHAT_MODEL` (default is `local-model`).
3. From the repo root, run:

```bash
npm run test:local-chat
```

If the URL is not set, the script exits successfully and prints a skip message. When set, it sends a single "Ping" request and asserts the response has parseable content (`choices[0].message.content` or a fallback field).

## References

- [DeepSeek API Documentation](https://platform.deepseek.com/docs)
- [Chat Models Reference](https://platform.deepseek.com/api-docs/zh/chat-api)
- [Reasoning Models Guide](https://platform.deepseek.com/api-docs/zh/reasoning-model)

## Example: End-to-End Workflow

```bash
# 1. Set environment variables
export ORCHESTRATOR_LOCAL_ENGINE_API_KEY="your-deepseek-api-key"
export ORCHESTRATOR_TELEMETRY_DIR="./telemetry"
export RUST_LOG=info

# 2. Build the orchestrator
cargo build --release

# 3. Create telemetry directory and sample files
mkdir -p telemetry
echo "CLASSIFIED,Satellite_ID_ALPHA,Lat:51.5,Lon:-0.1" > telemetry/classified.csv
echo "Status:OK,Lat:42.0,Lon:-71.0" > telemetry/normal.csv

# 4. Run the orchestrator
./target/release/gauss-orchestrator

# 5. Monitor logs
# You should see:
# [routing] 🧠 Sensitivity: HIGH. Routing to LOCAL DeepSeek...
# [routing] ☁️  Sensitivity: LOW/UNKNOWN. Routing to CLOUD (anonymized)...
```

---

**Last Updated**: February 23, 2026
**Orchestrator Version**: 0.1.0
