# ML Inference Service (ONNX)

- **POST /infer** — nowcast inference (same contract as backend `LOCAL_INFER_URL/infer`).
- **GET /health** — liveness.

## Model

Export a minimal ONNX model from repo root:

```bash
pip install torch
python3 ml/export/export_nowcast_onnx.py
```

This writes `services/ml-inference/model.onnx`. If the file is missing, the service still runs and returns deterministic fallback values.

## Run

```bash
cd services/ml-inference && npm install && npm start
```

Set `LOCAL_INFER_URL=http://localhost:8001` in the backend so `/api/ai/nowcast/infer` uses this service.
