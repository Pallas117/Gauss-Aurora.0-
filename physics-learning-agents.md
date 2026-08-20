---
name: gauss-agent-physics
type: agent
description: >
  Zone D agent — deterministic C++ physics backbone always running, fused ONNX head
  on demand, DeepSeek/Qwen3 LLM gated at 3-sigma. Never returns an error; always
  produces a result from the best available source.
---

# Gauss Physics + Inference Agent

## Identity
- Library: `libgauss_physics.so` (C++17, Eigen3)
- LLM server: llama.cpp at port 8088 (Qwen3-1.7B on edge, Qwen3-8B on laptop+)
- ONNX runtime: ONNX Runtime C++ with auto-delegate (NPU/GPU/CPU)

## Three inference lanes (always in priority order)
1. **Physics backbone** (always-on, deterministic): `compute_canonical()` — Bz, Kp, Dst, Shue, Alfvén
2. **Fused ONNX head** (when gate passes): storm/aurora/reconnection/action multi-task
3. **LLM** (3-sigma events only): Qwen3-1.7B→8B depending on hardware tier

## Ring 2 fallback
```
Fused ONNX → [disagree > threshold?] → physics wins, operator alerted
                                      → physics + ONNX both shown if close
```

## Probability gate (3-sigma rule)
```cpp
bool gate_llm_inference(const std::vector<CanonicalPoint>& w24, const GateConfig& c) {
    double sigma = compute_zscore(w24);
    return sigma >= c.threshold_sigma      // default 3.0
        && battery_pct() >= c.min_battery  // default 25
        && !low_power_mode();
}
```

## Output heads
- Head A: Storm escalation probability (next 30 min)
- Head B: Aurora intensity P10/P50/P90
- Head C: MMS reconnection probability + CI
- Head D: Radiation activity
- Head E: Operator action class (monitor|log|alert|reconfigure|hold)
- Head F: Trust/calibration + disagreement score vs deterministic

---
name: gauss-agent-learning
type: agent
description: >
  Zone H agent — runs the 6-stage offline repair loop, federated training coordination,
  backprop capsule generation, and event inbox processing. The back-substitution pass
  of the Gauss elimination engine.
---

# Gauss Learning Agent

## 6-stage repair loop
1. **Sense**: Read audit JSON, lint issues, backprop capsule, work queue
2. **Reduce**: Batch ≤3 files, ≤180 changed lines, drop anything needing network/packages
3. **Pair**: Freeze model (Qwen3-1.7B) + orchestrator scope — no scope creep after pairing
4. **Plan**: Qwen3-Coder-Next generates unified diff + validator plan
5. **Validate**: `npm run -s lint` + targeted tests + build if frontend touched
6. **Record**: Append to `autonomous-evaluation.jsonl` → backprop capsule → work queue

## Event learning inbox
```
reports/lessons/inbox/
  ├── *.json  → canonical lesson note + JSONL training row
  ├── *.md    → RAG re-index + trust manifest refresh
  ├── *.csv   → DuckDB ingest → feature store update
  └── *.gguf  → checkpoint verify → held for operator approval
```

## Federated training trigger conditions
- Gradient batches from N nodes received (N configurable, default 3)
- OR manual trigger via `federated_merge` MCP tool
- OR operator approval via Telegram

## Air-gap safe
`GAUSS_AIR_GAP=true` → all inference local, Fabric sync queued for reconnect,
PicoClaw cron maintains automation, repair loop runs fully offline.
