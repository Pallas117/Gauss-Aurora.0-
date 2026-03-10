# Learning Architecture Review (Pass 2)

## Current State

1. Learning and inference are still segmented into independent paths:
- Probability gate + threat fusion (`backend/ml-client/probability-gate.ts`) drives warning decisions.
- Nowcast inference (`backend/ml-client/client.ts`, `ml/infer/infer_server.py`) was deterministic by default.
- Surya endpoints (`/api/ai/surya/forecast`, `/api/ai/surya/flare`) are currently stub/proxy-first and often return fallback payloads when no external service is configured.
- RAG is retrieval-oriented and not yet a first-class probabilistic prior in forecasting.

2. Training existed, but live inference coupling was weak:
- `ml/train/train_unet.py` writes model metadata (`version`, `metrics`, `samples`, `predict_mean`) to `ml/models/registry.json`.
- Inference paths did not consistently consume this registry to alter behavior.

## What Changed In This Pass

1. Live inference now consumes latest trained registry artifacts:
- Node nowcast path reads latest ready model from registry and applies learned calibration to forecast trajectories.
- Python infer server path does the same and reports learned model version in both `/infer` outputs and `/health`.

2. Multi-source learning hooks were added to the request schema:
- `NowcastInferenceRequest` now accepts:
  - `exogenousSignals` (earth-core + solar-system context)
  - `ragMethodPriors` (retrieval-derived method guidance with weight/confidence)
- Both Node and Python nowcast inference paths ingest these priors and modulate forecast driver intensity.

3. Regression coverage now proves train->infer coupling:
- Node test executes `train_unet.py`, then verifies inference model version/output shifts.
- Python test does the same for `ml/infer/infer_server.py`.

## Segmentation Risks Still Present

1. Surya remains a separate model lane focused on solar activity, not fused latent-state learning.
2. Threat fusion, nowcast, and RAG priors are blended by heuristics, not learned joint optimization.
3. Registry-driven calibration currently uses aggregate summary stats (`predict_mean`) rather than learned weights/checkpoints.
4. No explicit drift monitor/gating between geophysical domains (solar, terrestrial, orbital, operational doctrine).

## Recommended Multi-Source ML Techniques

1. Hierarchical multi-encoder temporal fusion:
- Separate encoders for:
  - Solar wind / IMF / heliosphere
  - Geomagnetic + Earth-core proxies
  - SSA/debris conjunction signals
  - Mission ops telemetry / cyber context
  - RAG-derived method priors
- Fuse with cross-attention Temporal Fusion Transformer or Perceiver-style latent bottleneck.

2. Probabilistic forecasting (not point-only):
- Quantile regression (P10/P50/P90), CRPS-optimized heads, and conformal calibration.
- Keep operational gate on calibrated exceedance probability, not raw score.

3. Multi-task learning:
- Shared backbone + heads for:
  - Storm escalation probability
  - Aurora intensity
  - Collision/SSA risk
  - Recommended operator action
- Improves transfer across correlated phenomena.

4. Retrieval-conditioned forecasting:
- Convert RAG output into structured priors:
  - `method_id`, `domain`, `weight`, `confidence`, `validity_window`
- Train a small policy head that learns when to trust method priors vs telemetry.

5. Continual learning with safety:
- Shadow training, champion/challenger rollout, replay buffers, and rollback thresholds.
- Drift triggers per source family (solar, geophysical, SSA, operator doctrine).

## Concrete Next Steps (Recommended Order)

1. Replace summary-stat calibration with lightweight checkpointed regressor:
- Export compact model artifact (ONNX/MLX) and load by registry version.

2. Build a feature-store style dataset builder:
- Align 5s canonical data with slower exogenous series (earth-core/planetary) using temporal joins.
- Persist source provenance + quality flags per feature column.

3. Add method-prior extraction from RAG documents:
- Parse uploaded docs into structured method cards.
- Feed cards into `ragMethodPriors` with confidence and decay.

4. Add acceptance metrics for each forecast horizon:
- Reliability curves, Brier score, CRPS, action-trigger precision/recall.

5. Integrate triad orchestration into a fused model scheduler:
- Surya and broader system model should contribute to one calibrated risk surface before gate action.
