import type { FusedTensorEnvelope } from "./fused-features.js";

export interface FusedPredictionVector {
  stormEscalation: number;
  auroraIntensity: number;
  mmsReconnection: number;
  radiationActivity: number;
}

export interface CalibratedFusedPrediction extends FusedPredictionVector {
  disagreementScore: number;
  learnedWeight: number;
  degraded: boolean;
  reason: string;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function vector(value: FusedPredictionVector): FusedPredictionVector {
  return {
    stormEscalation: clamp01(value.stormEscalation),
    auroraIntensity: clamp01(value.auroraIntensity),
    mmsReconnection: clamp01(value.mmsReconnection),
    radiationActivity: clamp01(value.radiationActivity),
  };
}

export function calibrateFusedPrediction(
  learned: FusedPredictionVector,
  deterministic: FusedPredictionVector,
  tensor: FusedTensorEnvelope,
): CalibratedFusedPrediction {
  const learnedVector = vector(learned);
  const deterministicVector = vector(deterministic);
  const differences = [
    Math.abs(learnedVector.stormEscalation - deterministicVector.stormEscalation),
    Math.abs(learnedVector.auroraIntensity - deterministicVector.auroraIntensity),
    Math.abs(learnedVector.mmsReconnection - deterministicVector.mmsReconnection),
    Math.abs(learnedVector.radiationActivity - deterministicVector.radiationActivity),
  ];
  const disagreementScore = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const reliability = clamp01(tensor.reliability[9] ?? 0);
  const learnedWeight = disagreementScore > 0.35 || reliability < 0.4
    ? 0
    : Math.min(0.5, reliability * 0.5);
  const degraded = learnedWeight === 0;
  const blend = (learnedValue: number, deterministicValue: number): number =>
    clamp01(deterministicValue + (learnedValue - deterministicValue) * learnedWeight);
  return {
    stormEscalation: blend(learnedVector.stormEscalation, deterministicVector.stormEscalation),
    auroraIntensity: blend(learnedVector.auroraIntensity, deterministicVector.auroraIntensity),
    mmsReconnection: blend(learnedVector.mmsReconnection, deterministicVector.mmsReconnection),
    radiationActivity: blend(learnedVector.radiationActivity, deterministicVector.radiationActivity),
    disagreementScore,
    learnedWeight,
    degraded,
    reason: degraded
      ? "Deterministic backbone retained because reliability is low or learned disagreement is high"
      : "Learned residual blended within the bounded calibration budget",
  };
}
