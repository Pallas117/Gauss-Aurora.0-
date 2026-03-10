# Project Gauss: Orchestrator & Model Loading Audit (Apollo 6GB)

**Lead Systems Architect audit.** Sovereign Edge-AI stack on 8GB M1 with **6GB memory ceiling** (Apollo Standard). This doc describes the dual-agent hot-swapping design and how we avoid OOM during space-ops simulation.

## 1. Architecture Overview

| Component | Role | Memory |
|-----------|------|--------|
| **gauss_engine.py** | Single-agent load → run → **purge**. One model at a time. | ~0 MB when using HTTP; ~500 MB–2.5 GB during in-process load, then freed |
| **gauss_dual_agent.py** | Orchestrator: Agent 1 (Surya) → **mandatory flush** → Agent 2 (DeepSeek) → flush. | Never holds both models |
| **remote_gauss_api.py** | FastAPI bridge; runs hot-swap in **thread pool** so event loop is not blocked; React HUD keeps connection. | Executor max_workers=1 |
| **triad_pipeline.py** | CLI Surya→DeepSeek with same GC/cache sequence. | Same flush between stages |
| **surya_service.py** | FastAPI Surya; `_gc_and_clear()` after each request. | Torch MPS + MLX cleared |

## 2. Strict Teardown Sequence (Apollo Flush)

Order is critical. Every unload must do:

1. **`del model`**, **`del tokenizer`** (drop references)
2. **`gc.collect()`** — reclaim Python heap (~10–50 MB timing)
3. **`torch.mps.empty_cache()`** — M1 MPS (~50–150 MB after Surya)
4. **`mx.metal.clear_cache()`** — MLX Metal (~100–500 MB after DeepSeek)
5. **`gc.collect()`** again

Implemented in **`gauss_engine.apollo_flush()`** and mirrored in **`scripts/triad_pipeline._gc_and_clear()`** and **`ml/surya_service._gc_and_clear()`**.

## 3. MLX KV Cache Guardrails

- **Separate process (mlx_lm.server):** Use `MLX_EXTRA_ARGS="--cache-limit-gb 2.5"` when your mlx-lm supports it (see `scripts/process/run-mlx-deepseek.sh`).
- **In-process (gauss_engine.run_deepseek_inprocess):** Generation is capped with **`max_tokens`** (default 512; set `GAUSS_MLX_MAX_TOKENS`). Limits KV cache growth to ~200–400 MB for 4bit DeepSeek.

## 4. Lazy Instantiation

- Models are loaded **only** when the corresponding agent runs.
- **Agent 2 is never loaded** until **Agent 1 has been fully purged** (apollo_flush after Surya).
- In **remote_gauss_api**, the heavy work runs in **`run_in_executor`** so the async event loop is not blocked and the React HUD connection is not dropped.

## 5. Async Safety (FastAPI)

- **POST /triad** — runs `run_dual_agent_hot_swap` in a **ThreadPoolExecutor (max_workers=1)**. No two hot-swaps run in parallel.
- **POST /triad/background** — queues one run in background, returns `job_id` immediately; connection returns without waiting for load/purge.

## 6. Pre-Flight Ceiling Check

- **gauss_dual_agent.run_dual_agent_hot_swap** optionally checks **`scripts/memory/baseline_ram_check.py --ceiling 5800`** before starting. If system is already over 5.8 GB, the run is skipped and an error is returned (no load).

## 7. Stress-Test Command

From repo root, run the dual-agent pipeline multiple times and optionally assert memory stays under ceiling:

```bash
# From repo root: 5 triad runs (HTTP by default), no memory check
python3 scripts/stress_dual_agent_memory.py -n 5

# With memory ceiling check after each run (requires psutil)
python3 scripts/stress_dual_agent_memory.py -n 5 --check-memory --ceiling 5800

# If system is over ceiling but you want to exercise the flush sequence (e.g. CI)
python3 scripts/stress_dual_agent_memory.py -n 5 --no-ceiling-check

# With explicit source path
python3 scripts/stress_dual_agent_memory.py -n 10 --source ./telemetry_drop/sample.csv --check-memory
```

By default, DeepSeek runs via **HTTP** (default `http://127.0.0.1:8089`). To stress **in-process** load/unload (maximum memory churn), set **`GAUSS_DEEPSEEK_INPROCESS=1`** and have the MLX model available; leave `SURYA_SERVICE_URL` unset to use in-process Surya when `SURYA_MODEL_PATH` or `SURYA_USE_HF` is set.

## 8. File Reference

| File | Purpose |
|------|---------|
| **ml/gauss_engine.py** | `apollo_flush()`, `run_surya_inprocess`, `run_deepseek_inprocess`, HTTP fallbacks |
| **ml/gauss_dual_agent.py** | `run_dual_agent_hot_swap()`, pre-flight ceiling check |
| **ml/remote_gauss_api.py** | FastAPI app, POST /triad (sync in executor), POST /triad/background |
| **scripts/triad_pipeline.py** | CLI Surya→DeepSeek with `_gc_and_clear()` |
| **ml/surya_service.py** | Surya FastAPI; `_gc_and_clear()` after each request |
| **scripts/stress_dual_agent_memory.py** | Stress-test script |
| **scripts/memory/baseline_ram_check.py** | Ceiling check (--ceiling MB) |

## 9. Rust Orchestrator

The **gauss-orchestrator** (Rust) does **not** load Python/MLX models. It calls Surya and DeepSeek over **HTTP** (see `pipeline.rs`: `run_surya_step`, `run_deepseek_step`). So the 6GB ceiling applies to the process that *serves* Surya (e.g. surya_service.py) and the process that *serves* DeepSeek (e.g. mlx_lm.server or gauss-brain-stub). The dual-agent Python stack is an alternative that runs **both** agents in one process with hot-swap so only one model is in memory at a time.
