# GAUSS Orchestrator Testing Guide

This document provides a comprehensive guide to running, writing, and understanding tests in the GAUSS Orchestrator project.

## Test Overview

The orchestrator uses three complementary testing strategies:

1. **Unit Tests** — Fast, focused validation of individual functions
2. **Integration Tests** — Async HTTP mocking to verify routing behavior
3. **Property-Based Tests** — Robustness validation across input variations

### Test Status Summary

| Test Type | File | Count | Status |
|-----------|------|-------|--------|
| Unit (lib) | `src/*.rs` (analysis, anonymization, bug_tracker, code_*, network_management, pass_domain, provenance_ledger, ssa, telemetry, multi_agent) | 55 | ✅ Passing |
| Integration | `tests/ccsds_decoder_tests.rs` | 3 | ✅ Passing |
| Integration | `tests/integration_cloud_local.rs` | 2 | ✅ Passing |
| Integration | `tests/network_management_tests.rs` | 5 | ✅ Passing |
| Integration | `tests/packet_ingest_integration.rs` | 1 | ✅ Passing |
| Integration | `tests/decode_api_tests.rs` | 1 | ✅ Passing |
| Integration | `tests/telegram_commands_tests.rs` | 4 | ✅ Passing |
| Integration | `tests/telegram_connector_tests.rs` | 7 | ✅ Passing |
| Integration | `tests/xtce_mapping_tests.rs` | 4 | ✅ Passing |
| Integration | `tests/xtce_validation_tests.rs` | 1 | ✅ Passing |
| Property-Based | `tests/property_based_tests.rs` | 4 | ✅ Passing |
| **Total** | — | **87** | ✅ **All Passing** |

## Running Tests

### Run All Tests
```bash
cargo test --all-targets
# or from repo root:
npm run test:orchestrator
```

The root workspace runs the orchestrator suite as part of the full-adherence audit (`npm run audit:adherence`), so release preflight gates on orchestrator tests passing.

### Run Specific Test Suite
```bash
# Unit tests only (embedded in src/)
cargo test --lib

# Integration tests
cargo test --test '*'

# Property-based tests only
cargo test property_based

# Telegram tests only
cargo test telegram_connector
```

### Run a Specific Test by Name
```bash
cargo test detect_sensitive_content
```

### Run Tests with Output
```bash
cargo test -- --nocapture
```

### Run Tests with Logging
```bash
# Show structured JSON logs during tests
RUST_LOG=debug cargo test -- --nocapture --test-threads=1
```

## Test Categories

### 1. Unit Tests (Fast Path)

**Location**: Embedded in source files (`src/analysis.rs`, `src/anonymization.rs`, `src/config.rs`, etc.)

**Purpose**: Validate individual functions in isolation

**Example Tests**:
- `detect_sensitive_content()`: Tests keyword detection for HIGH/LOW/UNKNOWN sensitivity
- `anonymize_telemetry()`: Tests field-level masking (Satellite_ID → Asset, Lat/Lon → Loc_X/Y)
- `parse_env_bool()`: Tests boolean environment variable parsing with fallbacks

**Characteristics**:
- No external dependencies (no network, no file I/O)
- Run in ~50ms
- Deterministic (same input → same output always)

**Run**:
```bash
cargo test --lib
```

---

### 2. Integration Tests (End-to-End HTTP)

**Location**: `tests/integration_cloud_local.rs`

**Purpose**: Verify HTTP routing and mocking behavior with real async/await patterns

**Test Cases**:
1. **`test_route_to_local_engine`**: Mocks local DeepSeek server, sends telemetry, verifies request body
2. **`test_route_to_cloud_no_api_key`**: Verifies cloud routing fails gracefully without OpenAI API key

**Setup**:
```rust
use wiremock::{MockServer, Mock, ResponseTemplate};

let mock_server = MockServer::start().await;
// ... register mock expectations ...
```

**Why This Matters**: Validates that the orchestrator correctly formats HTTP requests to external services and handles missing credentials gracefully.

**Run**:
```bash
cargo test --test integration_cloud_local
```

---

### 2b. Decode API and canonical shape

**Location**: `tests/decode_api_tests.rs`, `tests/xtce_mapping_tests.rs`

**Purpose**: Ensure POST /telemetry/decode returns the expected response shape and that mapped packets have the canonical point shape (solarWind.speed, solarWind.density, magneticField.z) required by the backend and `clean_raw_window`.

- **`post_telemetry_decode_returns_decoded_and_mapped_packets`**: Calls the decode API router with fixture bytes, asserts status 200, decoded_count/mapped_count, and canonical_point structure.
- **`decode_and_map_packets_produces_canonical_shape_for_backend`**: Asserts that `decode_and_map_packets()` output matches the backend contract (solarWind, magneticField, quality_flags, uncertainty).

**Run**:
```bash
cargo test --test decode_api_tests
cargo test decode_and_map_packets_produces_canonical_shape_for_backend
```

---

### 3. Property-Based Tests (Robustness)

**Location**: `tests/property_based_tests.rs`

**Purpose**: Generate random inputs and verify invariants hold across all variations

**Dependencies**: `proptest` crate (added to `Cargo.toml` dev-dependencies)

**Test Cases**:

#### a) **Sensitivity Detection is Deterministic**
```rust
#[test]
fn prop_sensitivity_detection_is_deterministic() {
    proptest!(|(content in ".*")| {
        let (s1, _) = detect_sensitive_content(&content);
        let (s2, _) = detect_sensitive_content(&content);
        prop_assert_eq!(s1, s2, "Detection should be deterministic");
    });
}
```
- **Input**: Random UTF-8 strings of any length
- **Invariant**: Two calls with same input → same result
- **Why**: Ensures detection logic has no randomness or state-dependent behavior

#### b) **Anonymization is Idempotent**
```rust
#[test]
fn prop_anonymization_is_idempotent() {
    proptest!(|(content in ".*")| {
        let anon_once = anonymize_telemetry(&content);
        let anon_twice = anonymize_telemetry(&anon_once);
        prop_assert_eq!(
            anon_once, anon_twice,
            "Applying anonymization twice should equal once"
        );
    });
}
```
- **Input**: Random telemetry content
- **Invariant**: `anonymize(anonymize(x)) == anonymize(x)`
- **Why**: Prevents accidental double-masking if anonymization runs multiple times

#### c) **Anonymization Preserves Line Count**
```rust
#[test]
fn prop_anonymization_preserves_line_count() {
    proptest!(|(content in ".*")| {
        let original_lines = content.lines().count();
        let anon_content = anonymize_telemetry(&content);
        let anon_lines = anon_content.lines().count();
        prop_assert_eq!(
            original_lines, anon_lines,
            "Anonymization should not change line count"
        );
    });
}
```
- **Input**: Random multi-line telemetry
- **Invariant**: Line structure remains unchanged after anonymization
- **Why**: Ensures anonymization only modifies field values, not structure

#### d) **Detection Works for All Input Lengths**
```rust
#[test]
fn prop_detection_works_for_all_lengths() {
    proptest!(|(content in ".*")| {
        // Should not crash or panic for any length
        let _ = detect_sensitive_content(&content);
        let _ = anonymize_telemetry(&content);
        prop_assert!(true, "Should handle inputs of any length");
    });
}
```
- **Input**: Strings from 0 to thousands of bytes
- **Invariant**: No panics, no crashes
- **Why**: Validates robustness across edge cases (empty files, huge telemetry dumps)

---

### 4. Bug Tracker Unit Tests (Embedded)

**Location**: `src/bug_tracker.rs` (embedded at bottom of file)

**Purpose**: Validate bug tracking and severity management

**Test Cases**:
1. **`test_bug_report_creation`**: Verify BugReport builder and default values
2. **`test_bug_status_transitions`**: Test valid status update transitions
3. **`test_high_priority_filtering`**: Verify get_high_priority() correctly identifies Critical/High
4. **`test_module_filtering`**: Verify get_by_module() filters by component
5. **`test_status_counting`**: Verify count_by_status() aggregations

**Why This Matters**: Ensures bug tracking APIs are reliable for runtime error logging.

**Run**:
```bash
cargo test --lib bug_tracker
```

---

### 5. Telegram Connector Unit Tests

**Location**: `tests/telegram_connector_tests.rs`

**Purpose**: Validate Telegram integration without real bot network

**Test Cases**:
1. **Enabled/Disabled State**: Verifies TELEGRAM_ENABLED env var handling
2. **Notification Safety**: Confirms notify() handles network failures gracefully
3. **Error Message Formatting**: Tests notify_error() HTML escaping
4. **Success Messages**: Tests notify_success() formatting

**Why This Matters**: Ensures notifications are sent safely and don't crash the orchestrator if Telegram is down.

**Run**:
```bash
cargo test telegram_connector
```

---

## Automated Testing

### Auto-Fix Script

The `scripts/auto-fix.sh` script runs all code quality checks and tests:

```bash
bash ./scripts/auto-fix.sh
```

**Steps Executed**:
1. `cargo fmt` — Format all code
2. `cargo fix --allow-dirty` — Apply automated fixes
3. `cargo fmt --check` — Verify formatting compliance
4. `cargo clippy -- -D warnings` — Lint checks
5. `cargo test` — Full test suite

**Use Case**: Run before committing to ensure code quality

### GitHub Actions CI

The `.github/workflows/ci.yml` pipeline runs automatically on push/PR:

1. Rust toolchain setup
2. Dependency caching
3. **Auto-fix checks** (via `scripts/auto-fix.sh`)
4. **Full test suite with coverage** (via `cargo tarpaulin`)
5. Coverage upload to Codecov
6. Progress validation

---

## Understanding Property-Based Test Output

When a property-based test fails, proptest automatically **shrinks** the failing input to find the minimal case:

```
thread 'prop_anonymization_is_idempotent' panicked at 'assertion failed: anon_once == anon_twice'
  source tree:
    [Minimal shrunk case]
    anon_once: "Satellite_ID_123"
    anon_twice: "Asset_123"
```

**Interpretation**:
- proptest found that anonymizing `"Satellite_ID_123"` once gives `"Asset_123"`
- But anonymizing it again gives something different (e.g., `"Asset_123"` again)
- This indicates a bug in idempotency

**How to Debug**:
1. Run the failing test with `--nocapture`: `cargo test property_based -- --nocapture`
2. Look at the shrunk case (minimal failing input)
3. Write a **unit test** with that specific input:
   ```rust
   #[test]
   fn test_anonymization_regression_satellite_id() {
       let input = "Satellite_ID_123";
       let anon_once = anonymize_telemetry(input);
       let anon_twice = anonymize_telemetry(&anon_once);
       assert_eq!(anon_once, anon_twice);
   }
   ```
4. Fix the bug, verify unit test passes, re-run property test

---

## Test Coverage

### Generate Coverage Report

```bash
# Install tarpaulin if needed
cargo install cargo-tarpaulin

# Run with XML output for CI integration
cargo tarpaulin --out Xml --all

# View HTML report locally
cargo tarpaulin --out Html --all
open tarpaulin-report.html
```

### Target Coverage

| Module | Target | Current |
|--------|--------|---------|
| `src/analysis.rs` | 95%+ | — |
| `src/anonymization.rs` | 95%+ | — |
| `src/routing.rs` | 90%+ | — |
| `src/telegram_connector.rs` | 85%+ | — |
| `src/bug_tracker.rs` | 90%+ | — |

---

## Writing New Tests

### Unit Test Template

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_function_behavior() {
        // Arrange
        let input = "test_input";

        // Act
        let result = my_function(input);

        // Assert
        assert_eq!(result, expected_value);
    }
}
```

### Integration Test Template

```rust
#[tokio::test]
async fn test_async_behavior() {
    // Setup async mock server
    let mock_server = wiremock::MockServer::start().await;

    // Register mock expectation
    wiremock::Mock::given(...)
        .respond_with(...)
        .mount(&mock_server)
        .await;

    // Call function under test
    let result = route_to_cloud(/* args */).await;

    // Assert
    assert!(result.is_ok());
}
```

### Property-Based Test Template

```rust
#[test]
fn prop_my_invariant() {
    proptest!(|(input in ".*")| {
        let result = my_function(&input);
        // Assert invariant holds
        prop_assert!(result.is_valid());
    });
}
```

---

## Debugging Failed Tests

### Enable Logging

```bash
RUST_LOG=trace cargo test -- --nocapture --test-threads=1
```

### Debug Specific Test

```bash
cargo test test_name -- --exact --nocapture
```

### Inspect Panic Details

```bash
RUST_BACKTRACE=1 cargo test -- --nocapture
```

### Run Single-Threaded (Useful for State-Dependent Tests)

```bash
cargo test -- --test-threads=1
```

---

## Continuous Integration Workflow

### Local Development
1. Make changes
2. Run `bash ./scripts/auto-fix.sh` locally
3. Push to branch
4. GitHub Actions automatically runs full CI

### CI Pipeline
1. ✅ Checkout code
2. ✅ Setup Rust toolchain
3. ✅ Cache dependencies
4. ✅ Run `cargo fmt`, `cargo fix`, `cargo clippy`
5. ✅ Run all tests
6. ✅ Generate coverage
7. ✅ Upload to Codecov
8. ✅ Run progress check

---

## Quick Reference

| Task | Command |
|------|---------|
| Run all tests | `cargo test --all` |
| Run unit tests only | `cargo test --lib` |
| Run integration tests only | `cargo test --test '*'` |
| Run property tests only | `cargo test property_based` |
| Run with logging | `RUST_LOG=debug cargo test -- --nocapture` |
| Auto-fix before commit | `bash ./scripts/auto-fix.sh` |
| Generate coverage | `cargo tarpaulin --out Html` |
| Run specific test | `cargo test test_name -- --exact` |
| Debug with backtrace | `RUST_BACKTRACE=1 cargo test -- --nocapture` |

---

## Troubleshooting

### "test failure: left == right" but values look identical

Check for **whitespace** differences:
```bash
cargo test -- --nocapture | cat -A  # Shows special chars
```

### Property test shrinking is slow

Reduce iterations:
```bash
PROPTEST_CASES=100 cargo test property_based
```

### Integration tests timeout

Increase test timeout:
```bash
cargo test --test integration_cloud_local -- --test-threads=1
```

### Missing dependencies during tests

Ensure `Cargo.toml` dev-dependencies include:
- `wiremock` (integration tests)
- `proptest` (property tests)
- `tokio-test` (async unit tests)

---

## References

- [Proptest Book](https://docs.rs/proptest/latest/proptest/)
- [Tokio Testing](https://tokio.rs/#testing)
- [Cargo Test Documentation](https://doc.rust-lang.org/cargo/commands/cargo-test.html)
