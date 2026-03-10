# Satellite-Native Model Selection (Swarm Intelligence)

To simulate a **satellite network** (Swarm Intelligence), we choose a model that mimics the **SWaP (Size, Weight, and Power)** constraints of an orbital **On-Board Computer (OBC)**.

## Primary choice: DeepSeek-R1-Distill-Qwen-1.5B-4bit

### Rationale (the “why”)

| Concern | Choice |
|--------|--------|
| **OBC proxy** | A 1.5B parameter model (quantized) uses ~1.1 GB of VRAM. This approximates the memory overhead of a space-grade SoC after OS and telemetry buffers. |
| **Native reasoning** | Unlike standard small models, the “Distill-R1” version includes `<reasoning>` chain-of-thought. This is required for the **Mission Logic Stream** in the HUD. |
| **Throughput** | On an M1, this model can generate 50–80 tokens/sec, enabling near-instant **Detection-to-Action** latency (e.g. collision avoidance). |

### Apollo quantization (4-bit)

- **4-bit** is used because 8-bit is too heavy for the 6 GB budget and 2-bit loses the reasoning capability needed for complex orbital logic.
- See [PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE](.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc) and [ORCHESTRATOR_AND_MODEL_LOADING_AUDIT](ORCHESTRATOR_AND_MODEL_LOADING_AUDIT.md) for cache and teardown rules.

---

## 6 GB “Swarm” memory budget

To simulate a **satellite network** (3 nodes on one machine), the 6 GB ceiling is partitioned as follows:

| Component | RAM usage | Purpose |
|-----------|-----------|---------|
| **Node A (Command)** | 1.1 GB | DeepSeek-R1 1.5B (the Brain) |
| **Node B (Science)** | 0.8 GB | Surya-1.0 (physics engine) |
| **Node C (Network)** | 0.2 GB | Rust orchestrator & mesh comms |
| **KV cache buffer** | 1.0 GB | Fixed context for swarm coordination |
| **Data ingestion** | 1.5 GB | Polars lazy-loading & LanceDB RAG |
| **Codex HUD UI** | 0.4 GB | React/Vite interface |
| **Total** | **5.0 GB** | |
| **Remaining** | **1.0 GB** | Safety buffer |

In **Swarm mode**, the Command Node (MLX server) is launched with a **1 GB KV cache limit** so the combined stack stays under the ceiling. For a **single-node** run (no Surya/orchestrator in the same process), a **2.5 GB** cache is allowed (see `scripts/process/run-mlx-deepseek.sh` and `MLX_EXTRA_ARGS`).

---

## Satellite network configuration

### A. Launching the Command Node (Swarm budget)

Use **512 max tokens** (and, if your mlx-lm supports it, **1 GB cache**) when simulating the swarm on one machine:

```bash
# Swarm mode: --max-tokens 512 (fits 6 GB partition)
npm run dev:brain:mlx:swarm
```

Or manually:

```bash
python -m mlx_lm.server \
  --model "mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit" \
  --port 8088 \
  --max-tokens 512
```

**Note:** Some mlx-lm versions support `--cache-limit-gb 1.0` to cap KV cache; if yours does, run with `MLX_EXTRA_ARGS="--cache-limit-gb 1.0" npm run dev:brain:mlx:swarm`. If the server reports `unrecognized arguments: --cache-limit-gb`, omit it; `--max-tokens 512` still limits output length and helps stay within the 6 GB budget.

**Note:** The app uses **port 8088** for the MLX server to avoid clashing with Vite (8080) and the gauss-brain-stub (8089). Set `GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1` and `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions` when using this server.

### B. Single-node (default) vs Swarm

| Mode | Args | Use case |
|------|------|----------|
| Default | `MLX_EXTRA_ARGS` only (e.g. `--cache-limit-gb 2.5` if your mlx-lm supports it) | Single Command Node; Surya/DeepSeek hot-swap in dual-agent uses separate teardown. |
| Swarm | `--max-tokens 512` (+ optional `MLX_EXTRA_ARGS="--cache-limit-gb 1.0"` if supported) | Multi-instance simulation (Command + Science + Network) on one 6 GB host. |

See `scripts/process/run-mlx-deepseek.sh`: set `GAUSS_SWARM=1` or `MLX_CACHE_GB=1.0` for Swarm; the script always passes `--max-tokens 512` in Swarm mode. Cache limits depend on your mlx-lm version.

---

## Future-proofing: upgrade path

If the 1.5B model is too limited for swarm logic during testing, the next step is **not** to jump to 7B, but to:

- **Qwen2.5-Math-1.5B-Instruct**  
  Fine-tuned for high-precision math and physics, which matches the primary “work” of a satellite network, while staying within the same ~1.1 GB class.

---

## Related

- [ORCHESTRATOR_AND_MODEL_LOADING_AUDIT](ORCHESTRATOR_AND_MODEL_LOADING_AUDIT.md) — cache limits, in-process vs HTTP, dual-agent teardown.
- [MODEL_ARTIFACTS_AND_DEPLOY](MODEL_ARTIFACTS_AND_DEPLOY.md) — artifact layout and checksum-verify-before-deploy.
- [SURYA_INTEGRATION](SURYA_INTEGRATION.md) — Science node (Surya) and cache guidance.
- [PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE](../.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc) — 8 GB M1 / 6 GB Apollo ceiling and memory rules.
