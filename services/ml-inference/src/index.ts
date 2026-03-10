/**
 * ML Inference Service: load ONNX model, expose POST /infer for nowcast.
 * Contract: same as backend expects (NowcastInferenceRequest -> NowcastInferenceResponse).
 */

import express from "express";
import * as ort from "onnxruntime-node";

const PORT = Number(process.env.ML_INFERENCE_PORT ?? "8001");
const MODEL_PATH = process.env.ONNX_MODEL_PATH ?? "model.onnx";

let session: ort.InferenceSession | null = null;

async function loadSession(): Promise<ort.InferenceSession | null> {
  if (session) return session;
  try {
    session = await ort.InferenceSession.create(MODEL_PATH, { graphOptimizationLevel: "all" });
    return session;
  } catch (err) {
    console.warn("[ml-inference] ONNX load failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

interface NowcastInferenceRequest {
  horizonMinutes?: number;
  sequence?: Array<{
    solarWind?: { speed?: number; density?: number };
    magneticField?: { z?: number };
    indices?: { kp?: number };
    coupling?: { newell?: number };
  }>;
}

interface NowcastInferenceResponse {
  modelVersion: string;
  generatedAt: string;
  horizonMinutes: number;
  predictions: Array<{
    timestamp: string;
    geomagneticPerturbation: number;
    auroraIntensity: number;
    confidence: number;
  }>;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/infer", async (req, res) => {
  const body = req.body as NowcastInferenceRequest;
  const sequence = Array.isArray(body?.sequence) ? body.sequence : [];
  const last = sequence[sequence.length - 1];
  const speed = last?.solarWind?.speed ?? 400;
  const density = last?.solarWind?.density ?? 5;
  const bz = last?.magneticField?.z ?? 0;
  const horizonMinutes = Math.max(5, Math.min(Number(body?.horizonMinutes ?? 30), 180));
  const steps = Math.max(1, Math.min(24, Math.floor(horizonMinutes / 5)));

  const sess = await loadSession();
  let geomagnetic = 16;
  let aurora = 0.5;
  let confidence = 0.85;

  if (sess) {
    try {
      const input = new ort.Tensor("float32", new Float32Array([speed, density, bz]), [1, 3]);
      const out = await sess.run({ input });
      const output = out.output as ort.Tensor;
      const data = output.data as Float32Array;
      if (data && data.length >= 4) {
        geomagnetic = data[0];
        aurora = Math.max(0, Math.min(1, data[1]));
        confidence = Math.max(0.35, Math.min(0.95, data[2]));
      }
    } catch (err) {
      console.warn("[ml-inference] run failed:", err instanceof Error ? err.message : err);
    }
  }

  const now = Date.now();
  const predictions = Array.from({ length: steps }, (_, i) => ({
    timestamp: new Date(now + (i + 1) * 5 * 60 * 1000).toISOString(),
    geomagneticPerturbation: geomagnetic + i * 0.5,
    auroraIntensity: Math.max(0, Math.min(1, aurora - i * 0.02)),
    confidence: Math.max(0.35, confidence - i * 0.02),
  }));

  const response: NowcastInferenceResponse = {
    modelVersion: "onnx-nowcast-v1",
    generatedAt: new Date().toISOString(),
    horizonMinutes,
    predictions,
  };
  res.json(response);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, model: session ? "loaded" : "not-loaded" });
});

app.listen(PORT, () => {
  console.log("[ml-inference] listening on port", PORT, "model:", MODEL_PATH);
});
