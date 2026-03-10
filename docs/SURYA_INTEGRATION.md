# Surya Integration

Surya is NASA/IBM’s open-source heliophysics foundation model (366M parameters), pretrained on 9 years of SDO (AIA + HMI) data. This doc covers installation, backend/Turing flow, API contract, and frontend placement.

## Model and artifacts

- **Source:** [Hugging Face – nasa-ibm-ai4science/Surya-1.0](https://huggingface.co/nasa-ibm-ai4science/Surya-1.0)
- **Code/training:** [NASA-IMPACT/Surya](https://github.com/NASA-IMPACT/Surya) (GitHub)
- **Artifacts:** `surya.366m.v1.pt`, `config.yaml`, `scalers.yaml`
- **Use cases:** EUV forecasting, active region segmentation, solar wind prediction, **24h M/X-class solar flare forecasting**

## Install and run (research)

### Download and dependencies

- **Option 1:** Clone or download from Hugging Face (e.g. `huggingface_hub` in Python):
  ```python
  from huggingface_hub import hf_hub_download
  path = hf_hub_download(repo_id="nasa-ibm-ai4science/Surya-1.0", filename="surya.366m.v1.pt")
  ```
- **Option 2:** Clone the repo and use the HF repo’s `config.yaml` and `scalers.yaml` for preprocessing.

**Dependencies:** PyTorch (required). For M1: optional MLX port if available; otherwise run PyTorch on CPU or with MPS.

**Loading:** Load weights from `surya.366m.v1.pt` and apply `config.yaml` / `scalers.yaml` as in the Surya repo (see NASA-IMPACT/Surya and the HF model card).

### Constraints (8GB M1)

- **Lazy load:** Load model on first request or behind a feature flag; avoid loading at server boot if memory is tight.
- **Cache:** If using an MLX-based server, use `--cache-limit-gb` (e.g. 2.5) per project optimization directive.
- **Offload:** Prefer **on-demand** inference or **Turing-offload** (dispatch to a Turing device) so the main backend stays thin.

### Inputs

- **SDO-style:** AIA channels (8) and HMI products (5), or downsampled/cropped versions as documented in the Surya repo.
- **Preprocessing:** Apply `scalers.yaml` (and any config in `config.yaml`) as specified in the Surya repo.

---

## Backend / Turing flow

Two options:

| Option | Description |
|--------|--------------|
| **A (local)** | Backend (Node) calls a **local Python/ML service** that loads Surya and exposes e.g. `POST /surya/forecast` or `POST /surya/flare`. Backend proxies to it. |
| **B (Turing)** | Backend dispatches a **Turing compute job** (e.g. type `surya_forecast`). A Turing device runs Python + Surya and returns the result. |

**Chosen for stub:** **Option A** for simplicity and local development. Option B is recommended for production offload to keep the 8GB M1 backend from running the model.

- **Option A:** Backend route `POST /api/ai/surya/forecast` (and optionally `POST /api/ai/surya/flare`) calls the local ML service; response shape below.
- **Option B:** `ComputeJobType` includes `surya_forecast` and `surya_flare` (inference) and optionally `surya_finetune` / `nowcast_retrain` (training). Payload for forecast: time window (`startTime` / `endTime`), optional `channelIds`; device returns the same response shape as below. See [backend/turing/compute-dispatcher.ts](../backend/turing/compute-dispatcher.ts).

---

## API contract and stub

### Request (forecast)

- **Route:** `POST /api/ai/surya/forecast`
- **Auth:** operator (or admin) with mission clearance, same as nowcast.
- **Body (JSON):**
  - `startTime` (optional): ISO8601 start of window.
  - `endTime` (optional): ISO8601 end of window.
  - `channelIds` (optional): string[] of SDO channel IDs; if omitted, backend/service uses default set.

### Response (forecast) – documented shape

```json
{
  "forecast": [
    { "time": "2025-02-25T12:00:00Z", "value": 0.42 }
  ],
  "model": "surya.366m.v1",
  "horizonHours": 12
}
```

### Request (flare) – optional

- **Route:** `POST /api/ai/surya/flare`
- **Body:** `{ "timeWindow": "24h" }` or similar.

### Response (flare) – documented shape

```json
{
  "flare_probability_24h": 0.15,
  "model": "surya.366m.v1"
}
```

**Stub behavior:** The backend implements `POST /api/ai/surya/forecast` (and optionally `POST /api/ai/surya/flare`) and returns **501 Not Implemented** with a JSON body that matches the response shape above (e.g. empty `forecast` or placeholder `flare_probability_24h`) so clients can rely on the contract until real inference is wired.

---

## Frontend visual feedback

When the backend returns real Surya forecast or flare data:

- **Heliophysics dashboard:** [src/pages/HeliophysicsDashboard.tsx](src/pages/HeliophysicsDashboard.tsx) — solar wind / aurora area is the natural place for **solar wind forecast** or **EUV forecast** (e.g. small chart or badge).
- **Intel page:** [src/pages/IntelPage.tsx](src/pages/IntelPage.tsx) — **flare probability (24h)** can appear alongside threat cards (e.g. “Solar flare (M/X) 24h probability: 15%”).
- **New panel:** Alternatively, a dedicated “Surya” or “Solar forecast” panel can be added and linked from the dashboard or nav.

**Widgets / chart types to add when live:**

- Forecast: time-series chart (time vs value) for the `forecast` array.
- Flare: single metric or badge showing `flare_probability_24h` (e.g. percentage or “Low / Medium / High” band).

**Optional stub UI:** A minimal React component or hook that calls `GET` or `POST /api/ai/surya/forecast` (or the stub that returns 501) and shows “Surya (stub)” or “Solar model (coming soon)” can be added behind a feature flag (e.g. `VITE_FEATURE_SURYA_STUB=true`).

---

## Live 3D visualization

When Surya data is available and `VITE_FEATURE_SURYA_STUB=true` or `VITE_FEATURE_SURYA_3D_LIVE=true`, the 3D space weather scene uses Surya to drive:

- **Belt intensity:** Van Allen belt intensity is blended from canonical Kp and a Surya "activity" signal (mean of `forecast[].value`), so higher Surya activity increases belt intensity.
- **Radiation overlay:** The `forecast[]` time series is mapped to `RadiationDataPoint[]` (one point per time step at nominal LEO; `value` is scaled as a flux proxy) and passed to the 3D scene. The `forecast[].value` field is interpreted as a **normalized activity/flux proxy (0–1)** until the backend documents a physical scale; the mapper in `suryaRadiation.ts` uses a placeholder scale. When the backend returns real flux/EUV values, the same mapping can use a documented physical scale.

Implementation: [src/lib/suryaRadiation.ts](src/lib/suryaRadiation.ts) (activity and mapper); [src/pages/HeliophysicsDashboard.tsx](src/pages/HeliophysicsDashboard.tsx) (blend and `data` prop to SpaceScene). The dashboard can show a small attribution (e.g. "Radiation overlay: Surya forecast") when the 3D view is Surya-driven. See [docs/PLAN_SURYA_3D_LIVE_RADIATION.md](PLAN_SURYA_3D_LIVE_RADIATION.md) for the full plan.

---

## References

- [Hugging Face – Surya 1.0](https://huggingface.co/nasa-ibm-ai4science/Surya-1.0)
- [NASA-IMPACT/Surya (GitHub)](https://github.com/NASA-IMPACT/Surya)
- [ARCHITECTURE.md](ARCHITECTURE.md) – ML/inference and backend layout
