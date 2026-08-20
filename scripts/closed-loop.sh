#!/bin/bash
# Gauss Closed-Loop Training & Self-Healing Script
# Optimized for 8GB Apple Silicon

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_DIR="logs"
mkdir -p "${LOG_DIR}"
CYCLE_LOG="${LOG_DIR}/closed-loop-$(date +%Y%m%d-%H%M%S).log"

exec > >(tee -a "${CYCLE_LOG}") 2>&1

echo "=== Closed-Loop Cycle Started: $(date) ==="

# 1. Export telemetry from Bedrock
echo "[1/7] Exporting telemetry from Bedrock..."
# Placeholder: In a real deployment, this would query the local SQLite canonical store.
# For now, we ensure the raw feed exists.
if [ ! -f "ml/data/feed.json" ]; then
    echo "Warning: ml/data/feed.json not found. Using empty stub."
    echo '{"points": []}' > ml/data/feed.json
fi

# 2. Run refinery
echo "[2/7] Running Data Refinery..."
python3 ml/refinery/refinery.py \
    --input ml/data/feed.json \
    --output ml/data/clean.jsonl \
    --quarantine ml/data/quarantine.jsonl

# 3. Run dataset builder
echo "[3/7] Building dataset..."
python3 ml/train/dataset_builder.py \
    --input ml/data/feed.json \
    --output ml/data/train_dataset.jsonl \
    --refinery-pass

# 4. Run train_unet.py
echo "[4/7] Training U-Net model..."
if [ -s "ml/data/train_dataset.jsonl" ]; then
    python3 ml/train/train_unet.py --dataset ml/data/train_dataset.jsonl
else
    echo "Skipping training: clean dataset is empty."
fi

# 5. Apple MLX LoRA (Mac only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "[5/7] Checking for Apple MLX LoRA capability..."
    # Placeholder for mlx-lm LoRA fine-tune
fi

# 6. CyberTiger health check
echo "[6/7] CyberTiger health check & self-healing..."
# We trigger the internal anomaly check via the backend if running
curl -s -X POST http://localhost:13000/api/ops/cybertiger/check || echo "Backend not reachable for CyberTiger check."

# 7. Log cycle completion
echo "[7/7] Finalizing log..."
echo "=== Closed-Loop Cycle Completed: $(date) ==="
