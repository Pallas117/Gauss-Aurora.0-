import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";
import { fetchSpaceDomainSnapshot } from "@/lib/api/heliophysics-proxy";
import {
  getAdaptivePollInterval,
  getTrendAwarePollInterval,
} from "@/lib/power/polling";
import type {
  BackendMemoryPressureLevel,
  SpaceDomainAvailability,
  SpaceDomainAnalysis,
  PublicSpaceDomainSnapshot,
  SatelliteObjectsSnapshotResponse,
  SpaceDomainResponse,
  SpaceDomainSummary,
} from "@/lib/types/space-weather";
import type { RiskZonePoint } from "@/lib/types/radiation";
import { withVisualizationPriority } from "@/lib/visual-priority";

const POLL_INTERVAL_MS = 5_000;
const TREND_SAMPLE_LIMIT = 12;
const QUIET_BACKOFF_MS = 15_000;

function strongestRiskMetric(data: SpaceDomainResponse | null): number | null {
  if (!data) {
    return null;
  }

  const severityWeight =
    data.analysis.severity === "critical"
      ? 1
      : data.analysis.severity === "warning"
        ? 0.82
        : data.analysis.severity === "watch"
          ? 0.55
          : 0.18;
  const collisionWeight =
    data.analysis.metrics.maxCollisionProbability == null
      ? 0
      : Math.min(1, data.analysis.metrics.maxCollisionProbability * 100);

  return Math.max(
    severityWeight,
    data.analysis.metrics.learnedLaneScore,
    data.analysis.metrics.maxRiskScore,
    collisionWeight,
    data.summary.conjunctionRisk.recentCriticalCount > 0 ? 1 : 0,
  );
}

function dataTimestampMs(data: SpaceDomainResponse | null): number | null {
  if (!data) {
    return null;
  }
  const candidates = [
    data.analysis.generatedAt,
    data.snapshot.updatedAt,
    data.summary.updatedAt,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    const timestampMs = Date.parse(candidate);
    if (Number.isFinite(timestampMs)) {
      return timestampMs;
    }
  }
  return null;
}

function nextIntervalMs(
  data: SpaceDomainResponse | null,
  baseIntervalMs: number,
  samples: Array<{ timestampMs: number; value: number }>,
): number {
  const adaptiveBase = getAdaptivePollInterval(baseIntervalMs);
  if (!data) {
    return adaptiveBase;
  }

  if (
    data.analysis.changed ||
    data.analysis.severity === "warning" ||
    data.analysis.severity === "critical"
  ) {
    return adaptiveBase;
  }

  if (data.analysis.severity !== "quiet") {
    return adaptiveBase;
  }

  return Math.min(
    QUIET_BACKOFF_MS,
    getTrendAwarePollInterval(baseIntervalMs, samples, {
      maxSamples: TREND_SAMPLE_LIMIT,
      minSamples: 4,
      maxMultiplier: 3,
    }),
  );
}

function toRiskZonePoint(
  zone: NonNullable<PublicSpaceDomainSnapshot["riskZones"]>["riskZones"][number],
): RiskZonePoint {
  return withVisualizationPriority({
    orbitType: zone.orbitType,
    altitude: zone.altitudeKm,
    latitude: zone.latitudeDeg,
    longitude: zone.longitudeDeg,
    riskScore: zone.riskScore,
    objectCount: zone.objectCount,
    timestamp: undefined,
  });
}

export function useSpaceDomainSnapshot(options?: {
  enabled?: boolean;
  governorLevel?: BackendMemoryPressureLevel;
}) {
  const enabled = options?.enabled ?? true;
  const governorLevel = options?.governorLevel;
  const fetcher = useCallback(async () => fetchSpaceDomainSnapshot(), []);
  const [analysisTrend, setAnalysisTrend] = useState<number[]>([]);
  const lastTrendKeyRef = useRef<string | null>(null);
  const feed = useRealtimeFeed<SpaceDomainResponse | null>({
    fetcher,
    initialData: null,
    intervalMs: POLL_INTERVAL_MS,
    enabled,
    mapError: (error) =>
      error instanceof Error ? error.message : "Failed to fetch public space-domain snapshot",
    resolveIntervalMs: (data, baseIntervalMs, samples) =>
      nextIntervalMs(data, baseIntervalMs, samples),
    trendSampling: {
      maxSamples: TREND_SAMPLE_LIMIT,
      minSamples: 4,
      maxMultiplier: 3,
      selectMetric: (data) => strongestRiskMetric(data),
      selectTimestampMs: (data) => dataTimestampMs(data),
    },
    governor: {
      level: governorLevel,
      nominalMs: 5_000,
      constrainedMs: 15_000,
      criticalMs: 30_000,
      hiddenMs: 30_000,
    },
  });

  const data = enabled ? feed.data : null;
  const snapshot: PublicSpaceDomainSnapshot | null = data?.snapshot ?? null;
  const availability: SpaceDomainAvailability | null = data?.availability ?? null;
  const summary: SpaceDomainSummary | null = data?.summary ?? null;
  const analysis: SpaceDomainAnalysis | null = data?.analysis ?? null;
  const riskZones = snapshot?.riskZones?.riskZones.map(toRiskZonePoint) ?? [];
  const satellites: SatelliteObjectsSnapshotResponse | null = snapshot?.satellites ?? null;
  const conjunctions = snapshot?.conjunctions ?? { updatedAt: null, count: 0 };
  const loading = enabled ? data == null && feed.loading : false;
  const error = enabled && data == null ? feed.error : null;

  useEffect(() => {
    if (!summary) {
      return;
    }
    const trendKey = [
      analysis?.generatedAt ?? summary.updatedAt ?? snapshot?.updatedAt ?? "none",
      summary.learnedLane.score.toFixed(3),
    ].join("|");
    if (lastTrendKeyRef.current === trendKey) {
      return;
    }
    lastTrendKeyRef.current = trendKey;
    setAnalysisTrend((previous) =>
      [...previous, summary.learnedLane.score].slice(-TREND_SAMPLE_LIMIT),
    );
  }, [analysis?.generatedAt, snapshot?.updatedAt, summary, summary?.learnedLane.score, summary?.updatedAt]);

  return {
    data: data as SpaceDomainResponse | null,
    snapshot,
    availability,
    summary,
    analysis,
    analysisTrend,
    riskZones,
    satellites,
    conjunctions,
    loading,
    error,
    refresh: enabled ? feed.refresh : async () => {},
  };
}
