import type { SpaceDomainSnapshot } from "./space-domain-store.js";
import {
  assessSsaLearnedLane,
  type SsaLearnedLaneAssessment,
} from "../ml-client/ssa-learned-lane.js";

export interface SpaceDomainSummary {
  updatedAt: string | null;
  freshness: {
    riskZonesAgeSeconds: number | null;
    satellitesAgeSeconds: number | null;
    conjunctionsAgeSeconds: number | null;
  };
  availability: {
    riskZones: boolean;
    satellites: boolean;
    conjunctions: boolean;
  };
  counts: {
    riskZoneCount: number;
    satelliteObjectCount: number;
    highValueCount: number;
    unidentifiedCount: number;
    conjunctionCount: number;
  };
  crowding: {
    maxRiskScore: number;
    avgRiskScore: number;
    geoMaxRiskScore: number;
    meoMaxRiskScore: number;
    weightedObjectDensity: number;
    unidentifiedRatio: number;
  };
  conjunctionRisk: {
    maxCollisionProbability: number | null;
    minMissDistanceM: number | null;
    recentCriticalCount: number;
  };
  learnedLane: SsaLearnedLaneAssessment;
}

function toAgeSeconds(timestamp: string | null): number | null {
  if (!timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function recentCriticalConjunctionCount(events: SpaceDomainSnapshot["conjunctions"]["events"]): number {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const ingestedAtMs = Date.parse(event.ingestedAt);
    if (!Number.isFinite(ingestedAtMs) || ingestedAtMs < cutoffMs) {
      return false;
    }
    const probability = event.probabilityOfCollision ?? 0;
    const missDistanceM = event.missDistanceM ?? Number.POSITIVE_INFINITY;
    return probability >= 0.01 || missDistanceM <= 5_000;
  }).length;
}

export function buildSpaceDomainSummary(snapshot: SpaceDomainSnapshot): SpaceDomainSummary {
  const zones = snapshot.riskZones?.riskZones ?? [];
  const satellites = snapshot.satellites?.objects ?? [];
  const highValue = snapshot.satellites?.highValue ?? [];
  const unidentified = snapshot.satellites?.unidentified ?? [];
  const conjunctions = snapshot.conjunctions.events;

  const maxRiskScore = zones.reduce((max, zone) => Math.max(max, zone.riskScore ?? 0), 0);
  const avgRiskScore =
    zones.length > 0
      ? zones.reduce((sum, zone) => sum + (zone.riskScore ?? 0), 0) / zones.length
      : 0;
  const geoMaxRiskScore = zones
    .filter((zone) => zone.orbitType === "GEO")
    .reduce((max, zone) => Math.max(max, zone.riskScore ?? 0), 0);
  const meoMaxRiskScore = zones
    .filter((zone) => zone.orbitType === "MEO")
    .reduce((max, zone) => Math.max(max, zone.riskScore ?? 0), 0);
  const weightedObjectDensity =
    zones.length > 0
      ? zones.reduce((sum, zone) => sum + (zone.objectCount ?? 1) * Math.max(zone.riskScore ?? 0, 0), 0)
      : 0;
  const maxCollisionProbability = conjunctions.reduce<number | null>((max, event) => {
    const candidate = event.probabilityOfCollision;
    if (candidate == null || !Number.isFinite(candidate)) {
      return max;
    }
    return max == null ? candidate : Math.max(max, candidate);
  }, null);
  const minMissDistanceM = conjunctions.reduce<number | null>((min, event) => {
    const candidate = event.missDistanceM;
    if (candidate == null || !Number.isFinite(candidate)) {
      return min;
    }
    return min == null ? candidate : Math.min(min, candidate);
  }, null);

  const deterministicSummary = {
    updatedAt: snapshot.updatedAt,
    freshness: {
      riskZonesAgeSeconds: toAgeSeconds(snapshot.riskZones?.updatedAt ?? null),
      satellitesAgeSeconds: toAgeSeconds(snapshot.satellites?.updatedAt ?? null),
      conjunctionsAgeSeconds: toAgeSeconds(snapshot.conjunctions.updatedAt),
    },
    availability: {
      riskZones: zones.length > 0,
      satellites: satellites.length > 0,
      conjunctions: conjunctions.length > 0,
    },
    counts: {
      riskZoneCount: zones.length,
      satelliteObjectCount: satellites.length,
      highValueCount: highValue.length,
      unidentifiedCount: unidentified.length,
      conjunctionCount: conjunctions.length,
    },
    crowding: {
      maxRiskScore: clamp01(maxRiskScore),
      avgRiskScore: clamp01(avgRiskScore),
      geoMaxRiskScore: clamp01(geoMaxRiskScore),
      meoMaxRiskScore: clamp01(meoMaxRiskScore),
      weightedObjectDensity,
      unidentifiedRatio:
        satellites.length > 0 ? clamp01(unidentified.length / satellites.length) : 0,
    },
    conjunctionRisk: {
      maxCollisionProbability,
      minMissDistanceM,
      recentCriticalCount: recentCriticalConjunctionCount(conjunctions),
    },
  };

  return {
    ...deterministicSummary,
    learnedLane: assessSsaLearnedLane(snapshot, deterministicSummary),
  };
}
