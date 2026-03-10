# Surya Fine-Tuning Offload

Surya (NASA/IBM heliophysics foundation model, 366M parameters) is pretrained on 9 years of SDO data. This runbook describes how to **fine-tune Surya on project-specific heliophysics data** off-device (Turing or Hugging Face Jobs), so the 8GB M1 host is not used for training.

## Constraints

- **Do not run Surya training on the 8GB M1.** Use a Turing device or cloud GPU (e.g. Hugging Face Jobs) for fine-tuning.
- Local inference can run on M1 via [ml/surya_service.py](../ml/surya_service.py) with stub or optional real model load; see [SURYA_INTEGRATION.md](SURYA_INTEGRATION.md).

## Prerequisites

- [NASA-IMPACT/Surya](https://github.com/NASA-IMPACT/Surya) codebase (config, scalers, training script).
- [nasa-ibm-ai4science/Surya-1.0](https://huggingface.co/nasa-ibm-ai4science/Surya-1.0) artifacts: `surya.366m.v1.pt`, `config.yaml`, `scalers.yaml`.
- PyTorch and dependencies as in the Surya repo.
- Project heliophysics dataset: SDO-style (AIA/HMI) or proxy time series aligned with Surya input format.

## Option A: Turing device

1. **Prepare the Turing node** with Python, PyTorch, and the NASA-IMPACT/Surya repo (or a minimal training script that loads `surya.366m.v1.pt` and your dataset).
2. **Upload dataset** to the device or a shared store (e.g. Tailscale-accessible path or object store).
3. **Run training** on the Turing device (e.g. via `ComputeJobType: surya_finetune` if implemented, or SSH/script). Use the Surya repo’s training loop; override config for your data paths and output dir.
4. **Save artifacts** (checkpoint, config) to a path the backend or Surya service can read (e.g. `SURYA_MODEL_PATH` for [ml/surya_service.py](../ml/surya_service.py)).

## Option B: Hugging Face Jobs

1. **Create a HF Job** (or use the Hugging Face `train` / Jobs API) with a Python script that:
   - Downloads `nasa-ibm-ai4science/Surya-1.0` (or your fork) and your project dataset.
   - Runs the NASA-IMPACT/Surya training/fine-tuning loop.
   - Pushes the fine-tuned checkpoint to a HF repo or saves to job output.
2. **Download the checkpoint** from the job result and place it where the Surya service or Turing inference can load it (e.g. set `SURYA_MODEL_PATH`).

**Trigger via MCP or backend:** You can submit offload training (or Surya inference) via the Gauss MCP server (`npm run mcp:model-ops`) tool `run_training_job` with `job_type` `surya_finetune` or `nowcast_retrain`, or via backend `POST /api/turing/compute` with `type` `surya_finetune` / `nowcast_retrain` (and optionally `surya_forecast` / `surya_flare` for inference). See [MCP_MODEL_OPS.md](MCP_MODEL_OPS.md).

## Artifacts and deployment

- **Checkpoint:** After fine-tuning, store the model file (e.g. `surya.366m.finetuned.pt`) and any updated `config.yaml` / `scalers.yaml` in a versioned location per [MODEL_ARTIFACTS_AND_DEPLOY.md](MODEL_ARTIFACTS_AND_DEPLOY.md) (layout, manifest with checksum, verify-before-deploy).
- **Inference:** Point the Surya service (local or on Turing) at the new checkpoint via `SURYA_MODEL_PATH`; extend [ml/surya_service.py](../ml/surya_service.py) to load this checkpoint and run the same forecast/flare contract. Run `scripts/artifact_verify.py <version_dir>` before deploy.

## References

- [MODEL_ARTIFACTS_AND_DEPLOY.md](MODEL_ARTIFACTS_AND_DEPLOY.md) – Artifact layout, manifest schema, checksum verify, audit log.
- [SURYA_INTEGRATION.md](SURYA_INTEGRATION.md) – API contract, backend proxy, frontend.
- [NASA-IMPACT/Surya](https://github.com/NASA-IMPACT/Surya) – training code and config.
- [Hugging Face – Surya 1.0](https://huggingface.co/nasa-ibm-ai4science/Surya-1.0).
