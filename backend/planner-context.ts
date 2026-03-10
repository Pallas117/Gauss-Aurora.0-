import type { CanonicalSpaceWeatherPoint, SourceStatus } from "./types.js";

type TrendDirection = "rising" | "falling" | "steady";

export interface PlannerThreatContext {
  gateAction?: "TRIGGER_LLM" | "LOG_AND_SLEEP";
  topThreatType?: string | null;
  topThreatScore?: number | null;
  topRecommendedAction?: string | null;
  actionableThreatCount?: number;
}

export interface PlannerTrendSummary {
  sampleCount: number;
  windowMinutes: number;
  stormTier: CanonicalSpaceWeatherPoint["alerts"]["stormTier"] | "unknown";
  stormTiersSeen: Array<CanonicalSpaceWeatherPoint["alerts"]["stormTier"]>;
  solarWind: {
    latestSpeed: number | null;
    deltaSpeed: number | null;
    direction: TrendDirection;
    latestDensity: number | null;
  };
  imf: {
    latestBz: number | null;
    minBz: number | null;
    meanBz: number | null;
    direction: TrendDirection;
  };
  geomagnetic: {
    latestKp: number | null;
    maxKp: number | null;
    deltaKp: number | null;
    direction: TrendDirection;
  };
  coupling: {
    latestNewell: number | null;
    maxNewell: number | null;
    direction: TrendDirection;
  };
  quality: {
    staleSamples: number;
    lowConfidenceSamples: number;
  };
  sourceHealth: {
    healthyCount: number;
    degradedCount: number;
    degradedSources: string[];
  };
  sourcePolicy: Array<{
    source: string;
    decision: "primary" | "validate" | "sample" | "suspend" | "unknown";
    utilityScore: number | null;
    targetCadenceMs: number | null;
    healthy: boolean;
    observedCostScore: number | null;
    avgFetchDurationMs: number | null;
    avgCpuMs: number | null;
    avgPayloadKb: number | null;
  }>;
  operationalFlags: string[];
  threatContext: {
    gateAction: "TRIGGER_LLM" | "LOG_AND_SLEEP" | "unknown";
    actionableThreatCount: number;
    topThreatType: string | null;
    topThreatScore: number | null;
    topRecommendedAction: string | null;
  };
}

function round(value: number | null, digits = 2): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round((value ?? 0) * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function directionFromDelta(delta: number | null, threshold: number): TrendDirection {
  if (!Number.isFinite(delta)) {
    return "steady";
  }
  if ((delta ?? 0) > threshold) {
    return "rising";
  }
  if ((delta ?? 0) < -threshold) {
    return "falling";
  }
  return "steady";
}

function buildOperationalFlags(
  latest: CanonicalSpaceWeatherPoint | null,
  sequence: CanonicalSpaceWeatherPoint[],
  sourceStatus: SourceStatus[],
  threatContext: PlannerThreatContext | undefined,
): string[] {
  const flags = new Set<string>();
  const latestPoint = latest;
  const degradedSources = sourceStatus.filter((source) => !source.healthy);

  if (latestPoint?.alerts.stormTier === "warning" || latestPoint?.alerts.stormTier === "severe") {
    flags.add(`storm-tier:${latestPoint.alerts.stormTier}`);
  }

  if ((latestPoint?.indices.kp ?? 0) >= 5) {
    flags.add("kp-elevated");
  }

  if ((latestPoint?.magneticField.z ?? 0) <= -5) {
    flags.add("southward-imf-strong");
  }

  if ((latestPoint?.coupling.newell ?? 0) >= 15000) {
    flags.add("coupling-elevated");
  }

  if (sequence.some((point) => point.quality.stale)) {
    flags.add("stale-samples-present");
  }

  if (sequence.some((point) => point.quality.lowConfidence)) {
    flags.add("low-confidence-samples");
  }

  if (degradedSources.length > 0) {
    flags.add("source-degradation");
  }

  if (threatContext?.gateAction === "TRIGGER_LLM") {
    flags.add("threat-gate-escalated");
  }

  if ((threatContext?.actionableThreatCount ?? 0) > 0) {
    flags.add("actionable-threats-present");
  }

  return Array.from(flags).sort();
}

export function buildPlannerTrendSummary(input: {
  sequence: CanonicalSpaceWeatherPoint[];
  sourceStatus: SourceStatus[];
  threatContext?: PlannerThreatContext;
}): PlannerTrendSummary {
  const sequence = input.sequence.filter(
    (point) => typeof point.timestamp === "string" && Number.isFinite(Date.parse(point.timestamp)),
  );
  const latest = sequence.length > 0 ? sequence[sequence.length - 1]! : null;
  const first = sequence.length > 0 ? sequence[0]! : null;
  const speedValues = sequence.map((point) => point.solarWind.speed);
  const bzValues = sequence.map((point) => point.magneticField.z);
  const kpValues = sequence.map((point) => point.indices.kp);
  const newellValues = sequence.map((point) => point.coupling.newell);
  const staleSamples = sequence.filter((point) => point.quality.stale).length;
  const lowConfidenceSamples = sequence.filter((point) => point.quality.lowConfidence).length;
  const healthySources = input.sourceStatus.filter((source) => source.healthy);
  const degradedSources = input.sourceStatus.filter((source) => !source.healthy);
  const stormTiersSeen = Array.from(
    new Set(sequence.map((point) => point.alerts.stormTier)),
  ) as Array<CanonicalSpaceWeatherPoint["alerts"]["stormTier"]>;
  const startTs = first ? Date.parse(first.timestamp) : Number.NaN;
  const endTs = latest ? Date.parse(latest.timestamp) : Number.NaN;
  const windowMinutes =
    Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs
      ? Math.max(0, Math.round((endTs - startTs) / 60000))
      : 0;

  const threatContext = input.threatContext;

  return {
    sampleCount: sequence.length,
    windowMinutes,
    stormTier: latest?.alerts.stormTier ?? "unknown",
    stormTiersSeen,
    solarWind: {
      latestSpeed: round(latest?.solarWind.speed ?? null),
      deltaSpeed: round(
        latest && first ? latest.solarWind.speed - first.solarWind.speed : null,
      ),
      direction: directionFromDelta(
        latest && first ? latest.solarWind.speed - first.solarWind.speed : null,
        25,
      ),
      latestDensity: round(latest?.solarWind.density ?? null),
    },
    imf: {
      latestBz: round(latest?.magneticField.z ?? null),
      minBz: round(bzValues.length > 0 ? Math.min(...bzValues) : null),
      meanBz: round(average(bzValues)),
      direction: directionFromDelta(
        latest && first ? latest.magneticField.z - first.magneticField.z : null,
        1,
      ),
    },
    geomagnetic: {
      latestKp: round(latest?.indices.kp ?? null),
      maxKp: round(kpValues.length > 0 ? Math.max(...kpValues) : null),
      deltaKp: round(latest && first ? latest.indices.kp - first.indices.kp : null),
      direction: directionFromDelta(latest && first ? latest.indices.kp - first.indices.kp : null, 0.5),
    },
    coupling: {
      latestNewell: round(latest?.coupling.newell ?? null, 0),
      maxNewell: round(newellValues.length > 0 ? Math.max(...newellValues) : null, 0),
      direction: directionFromDelta(
        latest && first ? latest.coupling.newell - first.coupling.newell : null,
        1500,
      ),
    },
    quality: {
      staleSamples,
      lowConfidenceSamples,
    },
    sourceHealth: {
      healthyCount: healthySources.length,
      degradedCount: degradedSources.length,
      degradedSources: degradedSources.map((source) => source.source).sort(),
    },
    sourcePolicy: input.sourceStatus
      .map((source) => ({
        source: source.source,
        decision: source.powerDecision ?? "unknown",
        utilityScore:
          typeof source.utilityScore === "number" && Number.isFinite(source.utilityScore)
            ? round(source.utilityScore, 3)
            : null,
        targetCadenceMs:
          typeof source.targetCadenceMs === "number" && Number.isFinite(source.targetCadenceMs)
            ? Math.round(source.targetCadenceMs)
            : null,
        healthy: source.healthy,
        observedCostScore:
          typeof source.observedCostScore === "number" && Number.isFinite(source.observedCostScore)
            ? round(source.observedCostScore, 3)
            : null,
        avgFetchDurationMs:
          typeof source.avgFetchDurationMs === "number" && Number.isFinite(source.avgFetchDurationMs)
            ? round(source.avgFetchDurationMs, 1)
            : null,
        avgCpuMs:
          typeof source.avgCpuMs === "number" && Number.isFinite(source.avgCpuMs)
            ? round(source.avgCpuMs, 1)
            : null,
        avgPayloadKb:
          typeof source.avgPayloadKb === "number" && Number.isFinite(source.avgPayloadKb)
            ? round(source.avgPayloadKb, 1)
            : null,
      }))
      .sort((a, b) => {
        const scoreDelta = (b.utilityScore ?? -1) - (a.utilityScore ?? -1);
        if (Math.abs(scoreDelta) > 1e-9) {
          return scoreDelta;
        }
        return a.source.localeCompare(b.source);
      }),
    operationalFlags: buildOperationalFlags(latest, sequence, input.sourceStatus, threatContext),
    threatContext: {
      gateAction: threatContext?.gateAction ?? "unknown",
      actionableThreatCount: threatContext?.actionableThreatCount ?? 0,
      topThreatType: threatContext?.topThreatType ?? null,
      topThreatScore: round(threatContext?.topThreatScore ?? null),
      topRecommendedAction: threatContext?.topRecommendedAction ?? null,
    },
  };
}
