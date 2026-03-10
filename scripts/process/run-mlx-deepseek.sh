#!/usr/bin/env bash
# Start MLX DeepSeek server for local/dev use only (not for production).
# Port 8088: chosen to avoid Vite (8080) and the gauss-brain-stub (8089). Override with MLX_PORT.
# Requires: pip install mlx mlx-lm
# Then in .env set GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1 and ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions
#
# Swarm (6 GB satellite-network simulation): GAUSS_SWARM=1 or MLX_CACHE_GB=1.0
#   → --max-tokens 512 only (see docs/SATELLITE_NATIVE_MODEL_SELECTION.md).
#   Note: --cache-limit-gb is not supported by all mlx_lm.server versions; if yours supports it,
#   add MLX_EXTRA_ARGS="--cache-limit-gb 1.0" when running Swarm.
# Default: MLX_EXTRA_ARGS for single Command Node (e.g. --cache-limit-gb 2.5 where supported).

set -e
PORT="${MLX_PORT:-8088}"
MODEL="${MLX_MODEL:-mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit}"

# Swarm mode: cap output at 512 tokens for 6 GB partition (Command + Science + Network on one host).
if [[ -n "${GAUSS_SWARM}" ]] || [[ "${MLX_CACHE_GB}" == "1.0" ]]; then
  EXTRA="--max-tokens 512"
  # If your mlx_lm.server supports --cache-limit-gb, prepend it (e.g. MLX_EXTRA_ARGS="--cache-limit-gb 1.0").
  [[ -n "${MLX_EXTRA_ARGS}" ]] && EXTRA="${MLX_EXTRA_ARGS} ${EXTRA}"
else
  EXTRA="${MLX_EXTRA_ARGS:-}"
fi

if command -v mlx_lm.server &>/dev/null; then
  exec mlx_lm.server --model "$MODEL" --port "$PORT" $EXTRA "$@"
elif python3 -c "import mlx_lm" 2>/dev/null; then
  exec python3 -m mlx_lm.server --model "$MODEL" --port "$PORT" $EXTRA "$@"
else
  echo "Error: mlx_lm not found. Install with: pip install mlx mlx-lm" >&2
  exit 1
fi
