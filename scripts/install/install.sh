#!/usr/bin/env sh
#
# Project Gauss: one-line install for Alpha testers.
# Usage: curl -sSf https://gauss.sh/install | sh
#    or: curl -sSf https://raw.githubusercontent.com/.../install.sh | sh
#    or: ./scripts/install/install.sh   (when already inside the repo)
#
# Targets: Apple Silicon (M1/M2/M3) 8GB. Clones repo (if needed), npm i, Python .venv, deps.
# Set GAUSS_INSTALL_DIR to choose install directory (default: ./gauss-aurora).
#
set -e

INSTALL_DIR="${GAUSS_INSTALL_DIR:-./gauss-aurora}"
REPO_URL="${GAUSS_REPO_URL:-https://github.com/your-org/Gauss-Aurora.git}"

echo "Project Gauss install (Alpha)"
echo "  Install dir: $INSTALL_DIR"
echo ""

# If we're not in a git repo with package.json, clone
if ! git rev-parse --is-inside-work-tree 2>/dev/null || [ ! -f package.json ]; then
  if [ -d "$INSTALL_DIR" ]; then
    echo "Directory $INSTALL_DIR exists; updating..."
    (cd "$INSTALL_DIR" && git pull --rebase 2>/dev/null || true)
  else
    echo "Cloning repo..."
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
else
  echo "Already in repo; using current directory."
fi

if [ ! -f package.json ]; then
  echo "Error: package.json not found. Wrong REPO_URL or install dir?" >&2
  exit 1
fi

echo "Installing Node dependencies..."
npm install

if command -v python3 >/dev/null 2>&1; then
  echo "Setting up Python .venv..."
  python3 -m venv .venv 2>/dev/null || true
  . .venv/bin/activate 2>/dev/null || true
  if [ -f requirements.txt ]; then
    pip install -q -r requirements.txt
  fi
  if [ -f ml/rag/requirements.txt ]; then
    pip install -q -r ml/rag/requirements.txt
  fi
  echo "  Python .venv ready. Activate with: source .venv/bin/activate"
else
  echo "  (python3 not found; skip .venv. Install Python 3 for RAG/ML.)"
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  Copied .env.example to .env. Edit .env with your Supabase and optional keys."
fi

echo ""
echo "Next steps:"
echo "  1. Edit .env (Supabase URL, anon key; see docs/ALPHA_GO_NO_GO_CHECKLIST.md)"
echo "  2. Close heavy apps (Chrome, etc.) — 6GB limit on 8GB machines"
echo "  3. Start stack: npm run dev:stack   (stub) or npm start (MLX)"
echo "  4. Optional: pre-fetch ML model (see README Alpha testers section)"
echo ""
echo "Install complete."
