import type { FusedTensorEnvelope } from "./fused-features.js";
import {
  calibrateFusedPrediction,
  type CalibratedFusedPrediction,
  type FusedPredictionVector,
} from "./fused-calibration.js";

export type FusedOperatorAction = "monitor" | "log" | "alert" | "reconfigure" | "hold";

export interface FusedModelResult {
  modelVersion: string;
  fallback: boolean;
  prediction: CalibratedFusedPrediction;
  action: FusedOperatorAction;
}

export type FusedModelRunner = (tensor: FusedTensorEnvelope) => Promise<FusedPredictionVector>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function deterministicPrediction(tensor: FusedTensorEnvelope): FusedPredictionVector {
  const latest = tensor.physics[tensor.physics.length - 1] ?? [];
  const southwardImf = clamp01(-(latest[2] ?? 0));
  const kp = clamp01(latest[9] ?? 0);
  const coupling = clamp01(latest[7] ?? 0);
  const mms = clamp01(tensor.mms[9] ?? 0);
  return {
    stormEscalation: clamp01(0.55 * southwardImf + 0.3 * kp + 0.15 * coupling),
    auroraIntensity: clamp01(0.45 * southwardImf + 0.35 * kp + 0.2 * coupling),
    mmsReconnection: mms,
    radiationActivity: clamp01(0.4 * kp + 0.35 * coupling + 0.25 * (tensor.solar[4] ?? 0)),
  };
}

function actionFor(prediction: CalibratedFusedPrediction): FusedOperatorAction {
  if (prediction.degraded) return "hold";
  const score = Math.max(
    prediction.stormEscalation,
    prediction.mmsReconnection,
    prediction.radiationActivity,
  );
  if (score >= 0.8) return "alert";
  if (score >= 0.55) return "monitor";
  return "log";
}

/**
 * Run the tensor contract without loading a model or contacting a service.
 * A real ONNX/MLX runner can be injected later; absent one, the deterministic
 * physics/MMS path remains the only authority.
 */
export async function runFusedModel(
  tensor: FusedTensorEnvelope,
  runner?: FusedModelRunner,
): Promise<FusedModelResult> {
  const deterministic = deterministicPrediction(tensor);
  const learned = runner ? await runner(tensor) : deterministic;
  const prediction = calibrateFusedPrediction(learned, deterministic, tensor);
  return {
    modelVersion: runner ? "injected-fused-runner-v1" : "deterministic-tensor-fallback-v1",
    fallback: !runner,
    prediction,
    action: actionFor(prediction),
  };
}
