# Continuous Optimization Runbook

This runbook describes how to keep Gauss models and operator behavior optimized without on-device training: RAG re-index cadence, prompt and system-instruction tuning, offload retrain cadence, and the evaluation loop. Ethics and voice live in RAG and prompts and evolve with the team.

## RAG re-index cadence

- **When:** After any change under `research/documentation-rag` (including `spacecraft-ops-probability/` and ethics/voice docs). The co-pilot and Triad use RAG context; without re-index they will not see new or edited content.
- **How:** `POST /api/rag/index` with body `{ "dir": "research/documentation-rag" }` (or the subdir you changed). From the repo root you can use the MCP tool `rag_index` (see [MCP_MODEL_OPS.md](MCP_MODEL_OPS.md)) or call the RAG service directly (default port 3002).
- **Optional automation:** A weekly or post-merge job can run the index (e.g. cron or CI step calling the RAG index API). No code change required if the API is sufficient; document the cadence in [ml/rag/README.md](../ml/rag/README.md) if you add automation.

## Prompt and system-instruction tuning

- **Where:** System instructions and Triad prompts are in code: [gauss-orchestrator/src/routing.rs](../gauss-orchestrator/src/routing.rs) (`OPERATOR_SYSTEM_PROMPT`), [ml/rag/server.py](../ml/rag/server.py) (RAG system instruction), [scripts/triad_pipeline.py](../scripts/triad_pipeline.py), [gauss-orchestrator/src/pipeline.rs](../gauss-orchestrator/src/pipeline.rs).
- **Process:** Edit the prompt text in code; version in git. A/B or rollback = code revert. No model weight training; behavior changes are prompt and RAG content only.
- **Ethics and voice:** Mission ethics and Gauss voice are defined in [research/documentation-rag/spacecraft-ops-probability/mission-ethics-and-voice.md](../research/documentation-rag/spacecraft-ops-probability/mission-ethics-and-voice.md) and referenced in the prompts above. Treat these as living content: update them from backprop learnings, reflection ([reports/context/reflection-template.md](../reports/context/reflection-template.md)), or operator feedback. After editing the RAG doc, re-index RAG; after editing prompts, deploy the updated code.

## Surya / nowcast weights (offload retrain)

- **Cadence:** Periodic offload fine-tuning (e.g. quarterly or when new heliophysics data is available). See [SURYA_FINETUNING_OFFLOAD.md](SURYA_FINETUNING_OFFLOAD.md).
- **Process:** Build dataset, trigger Turing or Hugging Face Job (e.g. `surya_finetune` or `nowcast_retrain` via MCP `run_training_job` or backend `POST /api/turing/compute`), download checkpoint to the versioned artifact store, verify with `scripts/artifact_verify.py`, then deploy (set `SURYA_MODEL_PATH` or update active version). See [MODEL_ARTIFACTS_AND_DEPLOY.md](MODEL_ARTIFACTS_AND_DEPLOY.md).

## Evaluation loop

- **What:** Use the existing backprop capsule and/or a small golden set (e.g. operator decisions on sample telemetry). Run periodically (e.g. with backprop or CI).
- **Output:** Store results in `reports/progress/model-eval.latest.json` if you add a script (optional). The MCP tool `evaluate_model` runs `npm run context:backprop -- --short` and returns the summary.
- **Decision:** No automatic weight updates from eval; humans decide when to retrain or deploy. Use eval output to decide whether to tweak prompts, re-index RAG, or schedule an offload retrain.

## Summary

| Lever | Action | Cadence / trigger |
|-------|--------|--------------------|
| RAG content | Re-index after doc changes | After any edit under `research/documentation-rag`; optional weekly/post-merge |
| Prompts / ethics / voice | Edit in code and RAG doc; re-index RAG | When refining operator behavior or mission voice |
| Surya / nowcast weights | Offload retrain → artifact store → verify → deploy | Quarterly or when new data; trigger via MCP or backend |
| Eval | Backprop or golden set; optional `model-eval.latest.json` | With backprop or CI; MCP `evaluate_model` for on-demand |

Ethics and voice live in RAG and prompts and evolve with the team; re-index and prompt updates are the main levers for “developing together” without changing model weights.
