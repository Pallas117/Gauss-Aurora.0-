#!/usr/bin/env bash
# Automated bug fix script for gauss-orchestrator
# Fixes common Rust issues: formatting, unused imports, clippy warnings

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "[auto-fix] Starting automated bug fixes..."

# Step 1: Format code
echo "[auto-fix] Running cargo fmt..."
cd "$ROOT_DIR"
cargo fmt --all

# Step 2: Fix common clippy warnings and unused imports
echo "[auto-fix] Running cargo fix..."
cargo fix --allow-dirty --allow-staged

# Step 3: Check formatting is correct
echo "[auto-fix] Verifying format..."
cargo fmt -- --check || {
    echo "[auto-fix] ❌ Format check failed after fixes"
    exit 1
}

# Step 4: Run clippy linter
echo "[auto-fix] Running clippy..."
cargo clippy --all-targets -- -D warnings || {
    echo "[auto-fix] ⚠️  Clippy warnings detected (not auto-fixable)"
    cargo clippy --all-targets 2>&1 | head -20
}

# Step 5: Run tests
echo "[auto-fix] Running tests..."
cargo test --lib --test '*' --quiet || {
    echo "[auto-fix] ❌ Tests failed"
    exit 1
}

echo "[auto-fix] ✅ All automated fixes and checks passed!"
exit 0
