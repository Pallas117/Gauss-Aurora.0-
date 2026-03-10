import type { CanonicalSpaceWeatherPoint, NowcastInferenceRequest } from "../types.js";
import { clamp } from "../physics/coordinates.js";
import {
  SpaceProbabilityEngine,
  type ThreatResponseRow,
} from "./probability-fusion.js";
import { getSpaceDomainSnapshot } from "../ssa/space-domain-store.js";
import { buildSsaThreatContext } from "./ssa-threat-context.js";

export interface TelemetryUrgencyDecision {
  is_urgent: boolean;
  confidence: number;
  action: "TRIGGER_LLM" | "LOG_AND_SLEEP";
}

export interface InferenceUrgencyDecision extends TelemetryUrgencyDecision {
  flux_proxy: number;
  flux_latest: number;
  flux_mean: number;
  flux_max: number;
  reason: string;
  threat_count: number;
  actionable_threat_count: number;
  top_threat_type: string | null;
  top_threat_score: number;
  top_recommended_action: string | null;
  threat_summary: ThreatResponseRow[];
}

function erf(x: number): number {
  // Abramowitz and Stegun approximation (sufficient for gate confidence scoring).
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absX * absX));
  return sign * y;
}

function normalCdf(x: number, mean: number, sigma: number): number {
  if (!Number.isFinite(x)) return 0;
  if (!Number.isFinite(mean)) return 0;
  const safeSigma = Number.isFinite(sigma) && sigma > 0 ? sigma : 1e-8;
  const z = (x - mean) / (safeSigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

export class GaussProbabilityEngine {
  readonly fluxThreshold: number;
  readonly safetyMargin: number;
  readonly sigma: number;

  constructor(options?: { fluxThreshold?: number; safetyMargin?: number; sigma?: number }) {
    this.fluxThreshold = options?.fluxThreshold ?? 1.5e-4;
    this.safetyMargin = options?.safetyMargin ?? 0.15;
    this.sigma = options?.sigma ?? 5e-5;
  }

  calculateCollisionProbability(assetVector: number[], debrisCloud: number[]): number {
    const ax = Number(assetVector[0] ?? 0);
    const ay = Number(assetVector[1] ?? 0);
    const az = Number(assetVector[2] ?? 0);
    const dx = Number(debrisCloud[0] ?? 0);
    const dy = Number(debrisCloud[1] ?? 0);
    const dz = Number(debrisCloud[2] ?? 0);
    const distance = Math.hypot(ax - dx, ay - dy, az - dz);
    return 1 / (1 + Math.exp(distance - 10));
  }

  evaluateTelemetryUrgency(fluxValue: number): TelemetryUrgencyDecision {
    const effectiveThreshold = this.fluxThreshold * (1 - this.safetyMargin);
    const likelihood = normalCdf(fluxValue, effectiveThreshold, this.sigma);
    const isUrgent = likelihood > 0.85;
    return {
      is_urgent: isUrgent,
      confidence: Number((likelihood * 100).toFixed(2)),
      action: isUrgent ? "TRIGGER_LLM" : "LOG_AND_SLEEP",
    };
  }
}

const probabilityFusionEngine = new SpaceProbabilityEngine();

function deriveFluxProxy(point: CanonicalSpaceWeatherPoint): number {
  const southwardBzNt = Math.max(0, -(point.magneticField?.z ?? 0));
  const eyMvM = Math.abs(point.electricField?.ey ?? 0);
  const kpNorm = clamp((point.indices?.kp ?? 0) / 9, 0, 1);
  const couplingNorm = clamp(Math.log10((point.coupling?.newell ?? 0) + 1) / 4, 0, 1);
  const speedNorm = clamp(((point.solarWind?.speed ?? 400) - 300) / 900, 0, 1);
  const densityNorm = clamp((point.solarWind?.density ?? 5) / 30, 0, 1);

  return (
    4.5e-5 +
    southwardBzNt * 3.8e-6 +
    eyMvM * 1.6e-5 +
    kpNorm * 2.2e-5 +
    couplingNorm * 2.6e-5 +
    speedNorm * 1.2e-5 +
    densityNorm * 0.8e-5
  );
}

function isStormEscalated(point: CanonicalSpaceWeatherPoint): boolean {
  const tier = point.alerts?.stormTier;
  return tier === "warning" || tier === "severe";
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function threatConfidencePercent(topThreat: ThreatResponseRow | null, actionableCount: number): number {
  if (!topThreat) return actionableCount > 0 ? 70 : 60;
  const ciLower = topThreat.confidence_interval[0] ?? 0;
  const ciUpper = topThreat.confidence_interval[1] ?? 1;
  const intervalWidth = clamp(ciUpper - ciLower, 0, 1);
  const intervalConfidence = 1 - intervalWidth;
  const score = topThreat.composite_score;
  return clamp(Math.round((0.55 * score + 0.45 * intervalConfidence) * 100), 1, 99);
}

export function evaluateInferenceUrgency(
  request: NowcastInferenceRequest,
  engine?: GaussProbabilityEngine,
): InferenceUrgencyDecision {
  const selectedEngine =
    engine ??
    new GaussProbabilityEngine({
      fluxThreshold: envNumber("GAUSS_GATE_FLUX_THRESHOLD", 1.5e-4),
      safetyMargin: envNumber("GAUSS_GATE_SAFETY_MARGIN", 0.15),
      sigma: envNumber("GAUSS_GATE_SIGMA", 5e-5),
    });

  const sequence = (Array.isArray(request.sequence) ? request.sequence : []).filter(
    (point): point is CanonicalSpaceWeatherPoint => Boolean(point && typeof point === "object"),
  );
  if (sequence.length === 0) {
    return {
      is_urgent: true,
      confidence: 100,
      action: "TRIGGER_LLM",
      flux_proxy: selectedEngine.fluxThreshold,
      flux_latest: selectedEngine.fluxThreshold,
      flux_mean: selectedEngine.fluxThreshold,
      flux_max: selectedEngine.fluxThreshold,
      reason: "No telemetry sequence provided; fail-open to inference",
      threat_count: 0,
      actionable_threat_count: 0,
      top_threat_type: null,
      top_threat_score: 0,
      top_recommended_action: null,
      threat_summary: [],
    };
  }

  const recent = sequence.slice(-Math.min(24, sequence.length));
  const fluxValues = recent.map(deriveFluxProxy);
  const latestPoint = recent[recent.length - 1];
  const fluxLatest = fluxValues[fluxValues.length - 1] ?? selectedEngine.fluxThreshold;
  const fluxMean = fluxValues.reduce((acc, value) => acc + value, 0) / fluxValues.length;
  const fluxMax = Math.max(...fluxValues);
  const fluxProxy = 0.6 * fluxLatest + 0.25 * fluxMax + 0.15 * fluxMean;

  const { telemetry, externalData, learnedLane } = buildSsaThreatContext(recent, {
    spaceDomainSnapshot: getSpaceDomainSnapshot(),
    riskZones: request.riskZones,
  });
  const threatResult = probabilityFusionEngine.processTelemetry(telemetry, externalData);
  const threatSummary = threatResult.threats;
  const topThreat = threatSummary.length > 0 ? threatSummary[0] : null;
  const actionableCount = threatSummary.filter((threat) => threat.actionable).length;
  const threatTriggerThreshold = envNumber("GAUSS_GATE_THREAT_TRIGGER_SCORE", 0.72);
  const ssaLaneTriggerThreshold = clamp(
    envNumber("GAUSS_GATE_SSA_LANE_TRIGGER_SCORE", learnedLane.threshold),
    0,
    1,
  );
  const threatUrgent =
    (topThreat?.composite_score ?? 0) >= threatTriggerThreshold || actionableCount > 0;
  const learnedLaneUrgent =
    learnedLane.confidence >= 0.45 && learnedLane.score >= ssaLaneTriggerThreshold;
  const preferLearnedLaneReason =
    learnedLaneUrgent &&
    (!topThreat || (topThreat.type !== "collision" && topThreat.type !== "debris"));

  let decision = selectedEngine.evaluateTelemetryUrgency(fluxProxy);
  let reason = decision.is_urgent
    ? "Flux proxy exceeded trigger threshold"
    : "Nominal conditions; safe to skip remote inference";

  if (!decision.is_urgent && threatUrgent) {
    decision = {
      is_urgent: true,
      confidence: threatConfidencePercent(topThreat, actionableCount),
      action: "TRIGGER_LLM",
    };
    reason = topThreat
      ? `Threat fusion triggered (${topThreat.type}, score=${topThreat.composite_score.toFixed(2)})`
      : "Threat fusion triggered by actionable assessment";
  }

  if ((!decision.is_urgent && learnedLaneUrgent) || preferLearnedLaneReason) {
    decision = {
      is_urgent: true,
      confidence: clamp(
        Math.round((0.65 * learnedLane.score + 0.35 * learnedLane.confidence) * 100),
        1,
        99,
      ),
      action: "TRIGGER_LLM",
    };
    reason = `Learned SSA lane triggered (${learnedLane.modelVersion}, score=${learnedLane.score.toFixed(2)})`;
  }

  if (isStormEscalated(latestPoint)) {
    decision = {
      is_urgent: true,
      confidence: Math.max(decision.confidence, 95),
      action: "TRIGGER_LLM",
    };
    reason = `Storm tier ${latestPoint.alerts.stormTier} requires inference`;
  } else if ((latestPoint.quality?.stale ?? false) && !decision.is_urgent) {
    decision = {
      is_urgent: true,
      confidence: Math.max(decision.confidence, 90),
      action: "TRIGGER_LLM",
    };
    reason = "Telemetry marked stale; forcing inference for safety";
  }

  return {
    ...decision,
    flux_proxy: fluxProxy,
    flux_latest: fluxLatest,
    flux_mean: fluxMean,
    flux_max: fluxMax,
    reason,
    threat_count: threatSummary.length,
    actionable_threat_count: actionableCount,
    top_threat_type: topThreat?.type ?? null,
    top_threat_score: topThreat?.composite_score ?? 0,
    top_recommended_action: topThreat?.recommended_action ?? null,
    threat_summary: threatSummary,
  };
}
