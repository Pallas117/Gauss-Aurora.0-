# Closed-Loop Self-Sustaining System: Data Refinery, Self-Healing & Alert Sentry

## Research Findings (Frontier Lab Methods, 2025)

| Method | Source | Application |
|---|---|---|
| **Isolation Forest** | scikit-learn / FDL open-source | Unsupervised anomaly detection in high-dim telemetry, no labels needed |
| **Rolling IQR** | PyOD / statsmodels | Fast univariate outlier detection on NOAA/ESA time-series fields |
| **Great Expectations-style validation** | Open-source MLOps | Schema & range rule checks before data enters training |
| **Self-healing LLM agents** | 2025 industry standard | LLM root-cause analysis + automated remediation loop |
| **Apple MLX LoRA** | Apple open-source, mlx-lm | Fine-tunes LLMs locally on Apple Silicon — 100% offline, no cloud needed |

---

## Architecture: The Closed Loop

```
Live Telemetry (NOAA/ESA/MMS)
         │
   ┌─────▼─────────────────┐
   │  L1: Data Refinery    │  ← NEW: Isolation Forest + IQR filter
   │  (validate & quarantine)│
   └─────┬──────┬──────────┘
         │trash │clean
    archive  ───▼────────────────────┐
   table      L2: Bedrock SQLite     │  (3-layer redundancy L3)
              (canonical telemetry)  │
                   │                 │
         ┌─────────▼──────────┐      │
         │  Dataset Builder   │      │
         │  (sliding windows) │      │
         └─────────┬──────────┘      │
                   │                 │
         ┌─────────▼──────────┐      │
         │  train_unet.py     │◄─────┘
         │  (U-Net baseline)  │
         └─────────┬──────────┘
                   │
         ┌─────────▼──────────┐
         │  ml/models/registry│  ← model versions, loss curves
         └─────────┬──────────┘
                   │
         ┌─────────▼──────────┐
         │  CyberTiger Daemon │  ← self-healing: monitors anomalies,
         │  (anomaly resolver)│    restarts services, patches data gaps
         └─────────────────────┘
```

---

## Part 1 — Data Refinery Layer (Before Training)

> [!IMPORTANT]
> This runs **before** any data enters Supabase or the training pipeline. Trash data is archived, not deleted.

### Refinery Pipeline (3 stages):

**Stage 1: Schema Validation**
- Check all required fields are present and non-null
- Reject timestamps that are duplicated or out-of-order
- Enforce physical plausibility (solar wind speed 200–2000 km/s, Kp 0–9, IMF Bz -100 to +100 nT)

**Stage 2: Isolation Forest (Unsupervised)**
- Train a rolling Isolation Forest on the last 2000 clean samples
- Flag any new point with anomaly score > threshold as `quarantined`
- Points that fail get written to `sw_quarantine` table in Supabase, not `sw_raw_samples`

**Stage 3: Rolling IQR (Per-Field)**
- Apply moving IQR with a 60-sample window on each feature vector field
- Points more than 3×IQR outside the rolling median get soft-flagged as `interpolation_candidate`
- These are replaced with weighted linear interpolation rather than dropped

#### [NEW] ml/refinery/refinery.py
The main refinery pipeline. Reads from Bedrock, applies all 3 stages, writes clean JSONL and archives quarantined rows.

#### [NEW] ml/refinery/isolation_forest_detector.py
Stateful Isolation Forest detector. Maintains model state in `ml/models/refinery_state.json` and re-fits when >200 new clean samples arrive.

#### [NEW] ml/refinery/iqr_filter.py
Rolling IQR filter with configurable window size and per-field thresholds tuned to heliophysics data ranges.

#### [MODIFY] ml/train/dataset_builder.py
- Accept `--refinery-pass / --skip-refinery` flag
- Integrate refinery pipeline before building windows
- Output a data quality report alongside the JSONL

---

## Part 2 — Closed-Loop Training Pipeline

#### [NEW] scripts/closed-loop.sh
The master orchestration script. Runs on cron every 3 hours on mesh nodes:
```bash
1. Export telemetry from Bedrock → raw JSON feed
2. Run refinery → clean JSONL + quarantine archive
3. Run dataset_builder.py --input clean.json --output ml/data/train_dataset.jsonl
4. Run train_unet.py → update registry
5. (if MLX available) Run mlx-lm LoRA fine-tune on latest SLM
6. CyberTiger health check → auto-restart any degraded service
7. Log cycle to logs/closed-loop-$(date).log
```

#### [MODIFY] package.json scripts:
- `"train:refine"` → Python refinery pass
- `"train:dataset"` → builds JSONL from clean data
- `"train:model"` → trains U-Net
- `"train:loop"` → full closed-loop cycle
- `"train:mlx"` → Apple MLX local fine-tune (Mac-only, optional)

---

## Part 3 — Self-Healing: Anomaly Resolution via CyberTiger

The CyberTiger Daemon is extended to watch for **internal system anomalies** (not just security threats) and automatically resolve them.

#### [MODIFY] backend/cybertiger/daemon.ts
New internal monitoring loop (runs every 60s):
- Checks if ingest-loop is producing fresh canonical points (staleness > 90s = anomaly)
- Checks if ML forecast confidence is dropping (below 0.5 for 3 consecutive reads)  
- Checks Bedrock size is growing (not stuck)
- **Auto-remediation:** Restarts the failing sub-system via process signal or re-seeds mock data from the quarantine archive for continuity

#### [NEW] backend/cybertiger/self-healer.ts
A dedicated `SelfHealerAgent` class:
- `diagnoseIngestionStall()` — detects stuck ingest worker
- `healIngestionStall()` — resets the worker timer and forces a synthetic data tick
- `diagnoseMLDrift()` — detects if forecast probability has been flatlined (model not updating)
- `healMLDrift()` — triggers `POST /api/ai/nowcast/train` internally
- `reportHealing()` — logs self-healing events to CyberTiger event stream (visible in HUD)

---

## Part 4 — Authentication: Alert-First Sentry Canvas

#### [NEW] src/components/SentryCanvas.tsx
- **Alert-first**: begins in red ALERT state. Transitions to NOMINAL only after operator fingerprint verified
- Fingerprint: SHA-256 hash of device GPU, CPU count, screen res, camera count — stored in `localStorage`
- Live snooper detection: AmbientLightSensor, device enumeration change, visibility flips
- Visual states: ALERT (red shards) → LEARNING (cyan) → NOMINAL (gold polyhedron)

#### [NEW] src/lib/operator-fingerprint.ts
- `buildFingerprint()` — collects hardware signals
- `verifyFingerprint()` — compares against stored hash
- `learnDevice()` — stores new trusted device after operator successful auth

#### [MODIFY] src/pages/Login.tsx
- Title: "Authentication" (drop "Auth Gateway")
- Replace static Shield with `<SentryCanvas>`

---

## Part 5 — Playwright E2E Tests

#### [MODIFY] tests/e2e/auth-flow.spec.ts
- Assert h1 = "Authentication"
- Assert `#sentry-canvas` exists
- Assert initial `aria-label="sentry-state-alert"`
- Add localStorage fingerprint seed → assert transition to `sentry-state-nominal`

#### [NEW] tests/e2e/ui-forecast.spec.ts
- Mock `/api/forecast/anomaly` with Kp=2 (nominal) and Kp=8 (severe)
- Assert 72H banner colour classes and CI range text

---

## Verification Plan

```bash
# Python quality checks
python3 ml/refinery/refinery.py --dry-run
python3 ml/train/dataset_builder.py --input ml/data/feed.json --output ml/data/train_dataset.jsonl

# Full closed loop
npm run train:loop

# TypeScript + security
npx tsc --noEmit
npm run check:security-compliance

# E2E
npm run test:ui
```
