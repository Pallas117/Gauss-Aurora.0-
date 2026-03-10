import type {
  CanonicalSpaceWeatherPoint,
  MMSDirectionality,
  MMSReconVectorPoint,
  MMSReconnectionProbability,
} from "../types.js";
import {
  clamp,
  cross,
  dot,
  magnitude,
  normalize,
  scale,
  vec,
  type Vector3,
} from "./coordinates.js";
import {
  confidenceLabel,
  confidenceScore,
  mix,
  mixVec,
} from "./mms-probability-helpers.js";

const EPS = 1e-6;

export interface MMSVectorFusionInput {
  measuredVector: MMSReconVectorPoint | null;
  previousVector: MMSReconVectorPoint | null;
  canonicalPoint: CanonicalSpaceWeatherPoint | null;
  previousCanonicalPoint: CanonicalSpaceWeatherPoint | null;
  sampleCount: number;
  burstMode: boolean;
  nowIso: string;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function toVector3(value: { x: number; y: number; z: number }): Vector3 {
  return vec(value.x, value.y, value.z);
}

function cloneVector(point: MMSReconVectorPoint): MMSReconVectorPoint {
  return {
    timestamp: point.timestamp,
    barycenterGsmRe: { ...point.barycenterGsmRe },
    currentDensity: { ...point.currentDensity },
    normal: { ...point.normal },
    lmn: {
      l: { ...point.lmn.l },
      m: { ...point.lmn.m },
      n: { ...point.lmn.n },
    },
    quality: { ...point.quality },
    probability: point.probability ? { ...point.probability } : undefined,
    directionality: point.directionality ? { ...point.directionality } : undefined,
    provenance: point.provenance ? { ...point.provenance } : undefined,
  };
}

function inferReferenceDirection(
  canonicalPoint: CanonicalSpaceWeatherPoint | null,
  previousCanonicalPoint: CanonicalSpaceWeatherPoint | null,
  previousVector: MMSReconVectorPoint | null,
): { vector: Vector3; referenceVector: MMSDirectionality["referenceVector"]; reason: string } | null {
  const electricNow = canonicalPoint
    ? normalize(toVector3(canonicalPoint.electricField))
    : vec(0, 0, 0);
  const electricPrev = previousCanonicalPoint
    ? normalize(toVector3(previousCanonicalPoint.electricField))
    : vec(0, 0, 0);
  const electric = normalize(mixVec(electricNow, electricPrev, 0.25));
  if (magnitude(electric) > 0.2) {
    return {
      vector: electric,
      referenceVector: "electric-field",
      reason: "Aligned to convective electric field E=-v×B",
    };
  }

  const magneticNow = canonicalPoint
    ? normalize(toVector3(canonicalPoint.magneticField))
    : vec(0, 0, 0);
  const magneticPrev = previousCanonicalPoint
    ? normalize(toVector3(previousCanonicalPoint.magneticField))
    : vec(0, 0, 0);
  const magnetic = normalize(mixVec(magneticNow, magneticPrev, 0.25));
  if (magnitude(magnetic) > 0.2) {
    return {
      vector: magnetic,
      referenceVector: "magnetic-field",
      reason: "Fallback alignment to IMF vector direction",
    };
  }

  if (previousVector) {
    const history = normalize(toVector3(previousVector.normal));
    if (magnitude(history) > EPS) {
      return {
        vector: history,
        referenceVector: "history",
        reason: "Fallback alignment to previous MMS normal",
      };
    }
  }

  return null;
}

function rebuildLmn(
  lmn: MMSReconVectorPoint["lmn"],
  newNormal: Vector3,
): MMSReconVectorPoint["lmn"] {
  const l0 = normalize(toVector3(lmn.l));
  let m0 = normalize(cross(newNormal, l0));
  if (magnitude(m0) <= EPS) {
    m0 = normalize(toVector3(lmn.m));
  }
  const lOrtho = normalize(cross(m0, newNormal));
  const l = magnitude(lOrtho) > EPS ? lOrtho : l0;

  return {
    l: { x: l.x, y: l.y, z: l.z },
    m: { x: m0.x, y: m0.y, z: m0.z },
    n: { x: newNormal.x, y: newNormal.y, z: newNormal.z },
  };
}

function applyDirectionalityCorrection(
  vector: MMSReconVectorPoint,
  reference: ReturnType<typeof inferReferenceDirection>,
): MMSReconVectorPoint {
  if (!reference) {
    return {
      ...vector,
      directionality: {
        corrected: false,
        alignment: 0,
        referenceVector: "history",
        reason: "No external direction driver available",
      },
    };
  }

  const normal = normalize(toVector3(vector.normal));
  const alignment = dot(normal, reference.vector);
  if (alignment < -0.05) {
    const flippedNormal = scale(normal, -1);
    const current = toVector3(vector.currentDensity);
    const flippedCurrent = scale(current, -1);
    return {
      ...vector,
      currentDensity: {
        x: flippedCurrent.x,
        y: flippedCurrent.y,
        z: flippedCurrent.z,
        magnitude: magnitude(flippedCurrent),
      },
      normal: { x: flippedNormal.x, y: flippedNormal.y, z: flippedNormal.z },
      lmn: rebuildLmn(vector.lmn, flippedNormal),
      directionality: {
        corrected: true,
        alignment,
        referenceVector: reference.referenceVector,
        reason: reference.reason,
      },
    };
  }

  return {
    ...vector,
    directionality: {
      corrected: false,
      alignment,
      referenceVector: reference.referenceVector,
      reason: reference.reason,
    },
  };
}

function predictVector(
  previousVector: MMSReconVectorPoint,
  nowIso: string,
  reference: ReturnType<typeof inferReferenceDirection>,
  reconnectionProbability: number,
  burstMode: boolean,
): MMSReconVectorPoint {
  const ageSeconds = Math.max(0, (Date.parse(nowIso) - Date.parse(previousVector.timestamp)) / 1000);
  const decayWindow = burstMode ? 240 : 420;
  const decay = clamp(1 - ageSeconds / decayWindow, 0.55, 0.98);
  const prevCurrent = toVector3(previousVector.currentDensity);
  const prevCurrentDir = magnitude(prevCurrent) > EPS
    ? normalize(prevCurrent)
    : normalize(toVector3(previousVector.normal));
  const referenceDir = reference ? reference.vector : normalize(toVector3(previousVector.normal));
  const directionBlend = clamp(0.15 + reconnectionProbability * 0.45, 0.15, 0.65);
  const predictedDir = normalize(mixVec(prevCurrentDir, referenceDir, directionBlend));

  const predictedMagnitude = Math.max(
    0.02,
    previousVector.currentDensity.magnitude * decay * (0.85 + 0.5 * reconnectionProbability),
  );
  const predictedCurrent = scale(predictedDir, predictedMagnitude);
  const predictedNormal = normalize(mixVec(
    normalize(toVector3(previousVector.normal)),
    referenceDir,
    0.3,
  ));

  const prevConfidence = confidenceScore(previousVector.quality.confidence);
  const qualityScore = clamp(prevConfidence - 0.25 - ageSeconds / 1800, 0.1, 0.8);
  const quality = {
    ...previousVector.quality,
    valid: false,
    confidence: confidenceLabel(qualityScore),
    divCurlRatio: Math.min(2, previousVector.quality.divCurlRatio + 0.1),
    reason: "Predicted from prior MMS tetrahedron and solar-wind driver",
  };

  return {
    timestamp: nowIso,
    barycenterGsmRe: { ...previousVector.barycenterGsmRe },
    currentDensity: {
      x: predictedCurrent.x,
      y: predictedCurrent.y,
      z: predictedCurrent.z,
      magnitude: magnitude(predictedCurrent),
    },
    normal: {
      x: predictedNormal.x,
      y: predictedNormal.y,
      z: predictedNormal.z,
    },
    lmn: rebuildLmn(previousVector.lmn, predictedNormal),
    quality,
    directionality: {
      corrected: false,
      alignment: 0,
      referenceVector: reference?.referenceVector ?? "history",
      reason: reference?.reason ?? "Prediction-only mode",
    },
  };
}

function blendMeasuredAndPredicted(
  measured: MMSReconVectorPoint,
  predicted: MMSReconVectorPoint,
  blendWeight: number,
  nowIso: string,
): MMSReconVectorPoint {
  const w = clamp(blendWeight, 0, 0.5);
  const j = mixVec(toVector3(measured.currentDensity), toVector3(predicted.currentDensity), w);
  const n = normalize(mixVec(toVector3(measured.normal), toVector3(predicted.normal), w));
  const barycenter = mixVec(toVector3(measured.barycenterGsmRe), toVector3(predicted.barycenterGsmRe), w);

  const measuredScore = confidenceScore(measured.quality.confidence);
  const predictedScore = confidenceScore(predicted.quality.confidence);
  const blendedQualityScore = clamp(mix(measuredScore, predictedScore, w), 0.1, 1);

  const mergedReason = [measured.quality.reason, predicted.quality.reason]
    .filter(Boolean)
    .join("; ");

  return {
    ...measured,
    timestamp: nowIso,
    barycenterGsmRe: { x: barycenter.x, y: barycenter.y, z: barycenter.z },
    currentDensity: {
      x: j.x,
      y: j.y,
      z: j.z,
      magnitude: magnitude(j),
    },
    normal: { x: n.x, y: n.y, z: n.z },
    lmn: rebuildLmn(measured.lmn, n),
    quality: {
      ...measured.quality,
      confidence: confidenceLabel(blendedQualityScore),
      reason: mergedReason || measured.quality.reason,
    },
  };
}

function estimateProbability(args: {
  vector: MMSReconVectorPoint;
  previousVector: MMSReconVectorPoint | null;
  canonicalPoint: CanonicalSpaceWeatherPoint | null;
  sampleCount: number;
  burstMode: boolean;
  nowIso: string;
  mode: "measured" | "predicted" | "fused";
}): MMSReconnectionProbability {
  const bz = args.canonicalPoint?.magneticField.z ?? 0;
  const ey = Math.abs(args.canonicalPoint?.electricField.ey ?? 0);
  const newell = args.canonicalPoint?.coupling.newell ?? 0;
  const southwardImf = clamp(-bz / 10, 0, 1.5);
  const electricDriver = clamp(ey / 5, 0, 1.3);
  const coupling = clamp(Math.log10(newell + 1) / 3.5, 0, 1.3);
  const tetraQuality = confidenceScore(args.vector.quality.confidence) * (args.vector.quality.valid ? 1 : 0.7);
  const sampleCoverage = clamp(args.sampleCount / 4, 0, 1);
  const burstBoost = args.burstMode ? 0.2 : 0;
  const ageMinutes = Math.max(0, (Date.parse(args.nowIso) - Date.parse(args.vector.timestamp)) / 60000);
  const freshnessPenalty = clamp(ageMinutes / 20, 0, 1.5);

  const logit =
    -1.2 +
    1.45 * southwardImf +
    1.05 * electricDriver +
    1.2 * coupling +
    0.85 * tetraQuality +
    0.75 * sampleCoverage +
    burstBoost -
    0.7 * freshnessPenalty;

  const reconnection = clamp01(logistic(logit));

  const fromHistoryPenalty = args.previousVector ? 0 : 0.08;
  const modePenalty = args.mode === "predicted" ? 0.12 : args.mode === "fused" ? 0.06 : 0;
  const confidence = clamp(
    0.2 +
      0.3 * sampleCoverage +
      0.25 * tetraQuality +
      0.15 * clamp(coupling, 0, 1) +
      0.1 * (args.vector.quality.valid ? 1 : 0.5) -
      0.15 * freshnessPenalty -
      modePenalty -
      fromHistoryPenalty,
    0.05,
    0.98,
  );
  const sigma = clamp((1 - confidence) * 0.45 + (args.mode === "predicted" ? 0.08 : 0), 0.03, 0.5);

  return {
    reconnection,
    confidence,
    lower: clamp01(reconnection - sigma),
    upper: clamp01(reconnection + sigma),
    driver: args.mode,
    factors: {
      southwardImf,
      electricDriver,
      coupling,
      tetraQuality,
      sampleCoverage,
      burstBoost,
      freshnessPenalty,
    },
  };
}

export function fuseMmsVector(input: MMSVectorFusionInput): MMSReconVectorPoint | null {
  const {
    measuredVector,
    previousVector,
    canonicalPoint,
    previousCanonicalPoint,
    sampleCount,
    burstMode,
    nowIso,
  } = input;

  const reference = inferReferenceDirection(canonicalPoint, previousCanonicalPoint, previousVector);

  let mode: "measured" | "predicted" | "fused" = measuredVector ? "measured" : "predicted";
  let fused = measuredVector ? applyDirectionalityCorrection(cloneVector(measuredVector), reference) : null;

  if (!fused && previousVector) {
    fused = predictVector(previousVector, nowIso, reference, 0.5, burstMode);
    mode = "predicted";
  }

  if (fused && measuredVector && previousVector) {
    const predicted = predictVector(previousVector, nowIso, reference, 0.5, burstMode);
    const blendWeight = sampleCount >= 4 ? 0.15 : 0.35;
    fused = blendMeasuredAndPredicted(fused, predicted, blendWeight, nowIso);
    mode = "fused";
  }

  if (!fused) {
    return null;
  }

  const probability = estimateProbability({
    vector: fused,
    previousVector,
    canonicalPoint,
    sampleCount,
    burstMode,
    nowIso,
    mode,
  });

  if (mode === "predicted") {
    fused.quality = {
      ...fused.quality,
      valid: false,
      confidence: confidenceLabel(Math.max(0.15, confidenceScore(fused.quality.confidence) - 0.2)),
      reason: fused.quality.reason ?? "Predicted MMS reconnection vector",
    };
  }

  fused.probability = probability;
  fused.provenance = {
    mode,
    sampleCount,
    burstMode,
  };
  if (!fused.directionality) {
    fused.directionality = {
      corrected: false,
      alignment: 0,
      referenceVector: reference?.referenceVector ?? "history",
      reason: reference?.reason ?? "No direction reference available",
    };
  }

  return fused;
}
