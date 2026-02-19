import { spawn } from "node:child_process";
import type { NowcastInferenceRequest, NowcastInferenceResponse } from "../types.js";

const DEFAULT_MODEL_VERSION = "unet-baseline-v1";

export async function inferNowcast(
  request: NowcastInferenceRequest,
): Promise<NowcastInferenceResponse> {
  const inferUrl = process.env.LOCAL_INFER_URL;
  if (!inferUrl) {
    return localDeterministicInference(request);
  }

  const response = await fetch(`${inferUrl}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Inference server error ${response.status}`);
  }

  return (await response.json()) as NowcastInferenceResponse;
}

function localDeterministicInference(
  request: NowcastInferenceRequest,
): NowcastInferenceResponse {
  const last = request.sequence[request.sequence.length - 1];
  const kpBase = last?.indices.kp ?? 2;
  const bz = last?.magneticField.z ?? 0;
  const speed = last?.solarWind.speed ?? 400;
  const density = last?.solarWind.density ?? 5;
  const coupling = last?.coupling.newell ?? 0;

  const steps = Math.max(1, Math.min(24, Math.floor(request.horizonMinutes / 5)));
  const now = Date.now();
  const predictions = Array.from({ length: steps }, (_, i) => {
    const minutes = (i + 1) * 5;
    const t = new Date(now + minutes * 60 * 1000).toISOString();
    const driver = Math.max(0, -bz) * 0.45 + (speed - 350) * 0.004 + density * 0.05 + coupling / 8000;
    const geomagneticPerturbation = kpBase * 8 + driver * 12;
    const auroraIntensity = Math.max(0, Math.min(1, (kpBase / 9) * 0.7 + driver * 0.03));
    return {
      timestamp: t,
      geomagneticPerturbation,
      auroraIntensity,
      confidence: Math.max(0.35, Math.min(0.95, 0.9 - i * 0.02)),
    };
  });

  return {
    modelVersion: DEFAULT_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    horizonMinutes: request.horizonMinutes,
    predictions,
  };
}

export async function triggerTraining(): Promise<{ started: boolean; pid?: number; message: string }> {
  return new Promise((resolve) => {
    const script = process.env.TRAINING_SCRIPT_PATH ?? "ml/train/train_unet.py";
    const child = spawn("python3", [script], {
      stdio: "ignore",
      detached: true,
    });

    child.on("error", (error) => {
      resolve({ started: false, message: `Failed to start training: ${error.message}` });
    });

    child.unref();
    resolve({ started: true, pid: child.pid, message: "Training started" });
  });
}
