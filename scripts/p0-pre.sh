#!/usr/bin/env bash
# ============================================================
# P0-PRE: Fix .gitignore + clean bun.lockb + .env.example
# Run this FIRST, before any other P0 scripts
# ============================================================
set -euo pipefail
REPO="${GAUSS_ROOT:-$(pwd)}"
cd "$REPO"

echo "=== PRE: Fix .gitignore + .env.example ==="

# ── 1. .gitignore — add missing binary/data patterns ────────
if ! grep -q "*.gguf" .gitignore 2>/dev/null; then
  cat >> .gitignore << 'EOF'

# Gauss: model weights and databases (never commit these)
*.gguf
*.ggml
models/
data/*.db
data/*.duckdb
logs/
bun.lockb
reports/progress/*.json
reports/orchestrator/work-queue.json
EOF
  echo "✓ .gitignore updated (added *.gguf, *.db, models/, bun.lockb)"
else
  echo "✓ .gitignore already has *.gguf"
fi

# ── 2. Remove stale bun.lockb ────────────────────────────────
if [ -f bun.lockb ]; then
  git rm --cached bun.lockb 2>/dev/null || rm bun.lockb
  echo "✓ bun.lockb removed (using npm/package-lock.json)"
fi

# ── 3. .env.example — add Qwen3 + port registry ─────────────
if ! grep -q "GAUSS_BRAIN_URL" .env.example 2>/dev/null; then
  cat >> .env.example << 'EOF'

# ── LLM / QWEN3 STACK (P0) ───────────────────────────────────
# Primary LLM — Qwen3-1.7B via Ollama (Apache 2.0)
# Start with: OLLAMA_HOST=127.0.0.1:8000 ollama serve
LOCAL_INFER_URL=http://localhost:8000
GAUSS_BRAIN_URL=http://127.0.0.1:8000/v1
GAUSS_MODEL_NAME=qwen3:1.7b
ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8000/v1/chat/completions

# Embedding server — Qwen3-Embedding-8B (start: ollama pull qwen3-embedding:8b)
GAUSS_EMBED_URL=http://127.0.0.1:8089/v1

# PicoClaw reasoning augmentation
PICOCLAW_REASON_URL=http://127.0.0.1:8087/v1

# Audit database (SQLite, append-only)
GAUSS_VAULT=./data/audit.db

# ── PORT REGISTRY ─────────────────────────────────────────────
# 8000  Ollama/Qwen3-1.7B    LOCAL_INFER_URL (primary LLM)
# 8087  Qwen3-0.6B            PicoClaw adaptive reasoning
# 8089  Qwen3-Embedding-8B   RAG embeddings (#1 MTEB)
# 8090  Qwen3-Coder-Next      MCP tool generation (P1)
# 8091  Qwen3-Reranker-8B    RAG reranking (P1)
# 3001  Gauss backend proxy   (existing, keep)
# 3002  Gauss RAG service     (existing VITE_GAUSS_RAG_URL)
EOF
  echo "✓ .env.example updated with Qwen3 stack + port registry"
fi

# ── 4. Create data/ directory with .gitkeep ─────────────────
mkdir -p data logs
touch data/.gitkeep logs/.gitkeep
echo "✓ data/ and logs/ directories created"

# ── 5. Add package.json dev:brain script ────────────────────
if ! grep -q "dev:brain" package.json 2>/dev/null; then
  # Insert after "dev:infer" line
  node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.scripts['dev:brain'] = 'OLLAMA_HOST=127.0.0.1:8000 ollama serve';
pkg.scripts['dev:brain:qwen3'] = 'ollama run qwen3:1.7b';
pkg.scripts['check:llm'] = 'curl -s http://localhost:8000/api/tags | node -e \"const d=JSON.parse(require(\\\"fs\\\").readFileSync(0,\\\"utf8\\\")); console.log(d.models?.map(m=>m.name).join(\\\"\\\\n\\\") || \\\"no models\\\")\"';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)+'\n');
console.log('Added dev:brain, dev:brain:qwen3, check:llm to package.json');
"
fi

echo ""
echo "=== PRE complete ==="
echo "Next: bash p0-01-migrate-llm.sh"
echo ""
echo "Commit these changes:"
echo "  git add .gitignore .env.example package.json data/.gitkeep"
echo "  git commit -m 'P0-PRE: gitignore + env.example + Qwen3 scripts'"
