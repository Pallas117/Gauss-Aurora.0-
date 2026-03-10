import type {
  CanonicalSpaceWeatherPoint,
  RiskZoneInput,
} from "../types.js";
import type {
  DebrisExternalData,
  ExternalDataBundle,
  SpaceTrackObject,
  TelemetryBundle,
} from "./probability-fusion.js";
import type { SpaceDomainSnapshot } from "../ssa/space-domain-store.js";
import { buildSpaceDomainSummary, type SpaceDomainSummary } from "../ssa/ssa-features.js";

const EARTH_RADIUS_KM = 6371;
const DEFAULT_REFERENCE_ALTITUDE_KM = 35786;
const MAX_SPACE_TRACK_OBJECTS = 32;
const MAX_DEBRIS_OBJECTS = 32;

export interface SsaThreatContext {
  telemetry: TelemetryBundle;
  externalData: ExternalDataBundle;
  spaceDomainSummary: SpaceDomainSummary;
  learnedLane: SpaceDomainSummary["learnedLane"];
  referenceAsset: {
    source: "high-value" | "catalog" | "risk-zone" | "canonical-proxy";
    noradId: string | null;
    orbitType: "LEO" | "MEO" | "GEO" | null;
  };
}

type SatelliteLike = NonNullable<NonNullable<SpaceDomainSnapshot["satellites"]>["objects"]>[number];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function latLonAltToCartesian(
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeKm: number,
): [number, number, number] {
  const lat = (latitudeDeg * Math.PI) / 180;
  const lon = (longitudeDeg * Math.PI) / 180;
  const r = EARTH_RADIUS_KM + altitudeKm;
  return [
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.cos(lat) * Math.sin(lon),
    r * Math.sin(lat),
  ];
}

function approximateVelocity(orbitType: "LEO" | "MEO" | "GEO" | null, longitudeDeg = 0): [number, number, number] {
  const speed =
    orbitType === "LEO" ? 7.67 : orbitType === "MEO" ? 3.9 : orbitType === "GEO" ? 3.07 : 3.1;
  const lon = (longitudeDeg * Math.PI) / 180;
  return [
    -Math.sin(lon) * speed,
    Math.cos(lon) * speed,
    0,
  ];
}

function distance(a: number[], b: number[]): number {
  const ax = Number(a[0] ?? 0);
  const ay = Number(a[1] ?? 0);
  const az = Number(a[2] ?? 0);
  const bx = Number(b[0] ?? 0);
  const by = Number(b[1] ?? 0);
  const bz = Number(b[2] ?? 0);
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function riskZonesToDebrisData(zones: RiskZoneInput[]): DebrisExternalData {
  const objects = zones.slice(0, MAX_DEBRIS_OBJECTS).map((zone) => ({
    position: latLonAltToCartesian(
      zone.latitudeDeg ?? 0,
      zone.longitudeDeg ?? 0,
      zone.altitudeKm,
    ),
  }));
  const weightedDensity =
    zones.length > 0
      ? zones.reduce((sum, zone) => sum + Math.max(zone.riskScore ?? 0, 0) * (zone.objectCount ?? 1), 0) /
        Math.max(
          1,
          zones.reduce((sum, zone) => sum + Math.max(zone.objectCount ?? 1, 1), 0),
        )
      : 0.01;

  return {
    objects,
    density: clamp(weightedDensity, 0.01, 1),
  };
}

function chooseReferenceAsset(
  snapshot: SpaceDomainSnapshot | null | undefined,
  riskZones: RiskZoneInput[],
  fallbackPosition: [number, number, number],
): {
  position: [number, number, number];
  velocity: [number, number, number];
  positionUncertainty: number;
  source: SsaThreatContext["referenceAsset"]["source"];
  noradId: string | null;
  orbitType: "LEO" | "MEO" | "GEO" | null;
} {
  const highValue = snapshot?.satellites?.highValue?.[0] ?? null;
  if (highValue) {
    return {
      position: latLonAltToCartesian(highValue.latitudeDeg, highValue.longitudeDeg, highValue.altitudeKm),
      velocity: approximateVelocity(highValue.orbitType, highValue.longitudeDeg),
      positionUncertainty: 0.12,
      source: "high-value",
      noradId: highValue.noradId,
      orbitType: highValue.orbitType,
    };
  }

  const object = snapshot?.satellites?.objects?.[0] ?? null;
  if (object) {
    return {
      position: latLonAltToCartesian(object.latitudeDeg, object.longitudeDeg, object.altitudeKm),
      velocity: approximateVelocity(object.orbitType, object.longitudeDeg),
      positionUncertainty: object.unidentified ? 0.35 : 0.18,
      source: "catalog",
      noradId: object.noradId,
      orbitType: object.orbitType,
    };
  }

  const zone = riskZones[0];
  if (zone) {
    const orbitType = zone.orbitType === "GEO" ? "GEO" : "MEO";
    return {
      position: latLonAltToCartesian(zone.latitudeDeg ?? 0, zone.longitudeDeg ?? 0, zone.altitudeKm),
      velocity: approximateVelocity(orbitType, zone.longitudeDeg ?? 0),
      positionUncertainty: 0.4,
      source: "risk-zone",
      noradId: null,
      orbitType,
    };
  }

  return {
    position: fallbackPosition,
    velocity: approximateVelocity("GEO", 0),
    positionUncertainty: 0.45,
    source: "canonical-proxy",
    noradId: null,
    orbitType: "GEO",
  };
}

function buildSpaceTrackObjects(
  snapshot: SpaceDomainSnapshot | null | undefined,
  referencePosition: [number, number, number],
  referenceNoradId: string | null,
): SpaceTrackObject[] {
  const objects = snapshot?.satellites?.objects ?? [];
  return objects
    .filter((object) => object.noradId !== referenceNoradId)
    .map((object) => ({
      object,
      entry: {
        position: latLonAltToCartesian(object.latitudeDeg, object.longitudeDeg, object.altitudeKm),
        velocity: approximateVelocity(object.orbitType, object.longitudeDeg),
      } satisfies SpaceTrackObject,
    }))
    .sort((a, b) => distance(referencePosition, a.entry.position) - distance(referencePosition, b.entry.position))
    .slice(0, MAX_SPACE_TRACK_OBJECTS)
    .map((row) => row.entry);
}

function buildSolarContext(recent: CanonicalSpaceWeatherPoint[]) {
  const latest = recent[recent.length - 1]!;
  const maxRecentKp = recent.reduce((max, point) => Math.max(max, point.indices?.kp ?? 0), 0);
  const bzSouth = Math.max(0, -(latest.magneticField?.z ?? 0));

  return {
    complexity: clamp(2 + (latest.indices?.kp ?? 0) * 0.5 + bzSouth / 6, 1, 6),
    magnetic_field: clamp(120 + (latest.magneticField?.bt ?? 0) * 35, 40, 1200),
    history: clamp(maxRecentKp / 9, 0, 1),
  };
}

function defaultFallbackPosition(latest: CanonicalSpaceWeatherPoint): [number, number, number] {
  const longitudeDeg = clamp((latest.electricField?.ey ?? 0) * 18, -180, 180);
  return latLonAltToCartesian(0, longitudeDeg, DEFAULT_REFERENCE_ALTITUDE_KM);
}

export function buildSsaThreatContext(
  points: CanonicalSpaceWeatherPoint[],
  options?: {
    spaceDomainSnapshot?: SpaceDomainSnapshot | null;
    riskZones?: RiskZoneInput[];
  },
): SsaThreatContext {
  const recent = points.slice(-Math.min(24, points.length));
  const latest = recent[recent.length - 1]!;
  const snapshot = options?.spaceDomainSnapshot ?? null;
  const riskZones = options?.riskZones ?? snapshot?.riskZones?.riskZones ?? [];
  const fallbackPosition = defaultFallbackPosition(latest);
  const referenceAsset = chooseReferenceAsset(snapshot, riskZones, fallbackPosition);
  const spaceTrackObjects = buildSpaceTrackObjects(snapshot, referenceAsset.position, referenceAsset.noradId);
  const summary = buildSpaceDomainSummary({
    updatedAt: snapshot?.updatedAt ?? null,
    riskZones: riskZones === snapshot?.riskZones?.riskZones ? snapshot?.riskZones ?? null : {
      riskZones: riskZones,
      updatedAt: snapshot?.riskZones?.updatedAt ?? new Date().toISOString(),
    },
    satellites: snapshot?.satellites ?? null,
    conjunctions: snapshot?.conjunctions ?? {
      events: [],
      updatedAt: null,
    },
  });
  const learnedLane = summary.learnedLane;

  const baseConjunctionRate = clamp(
    (summary.counts.conjunctionCount / 20) * 0.55 +
      (summary.conjunctionRisk.maxCollisionProbability ?? 0) * 0.45,
    0,
    1,
  );
  const conjunctionRate = clamp(
    baseConjunctionRate * (1 - learnedLane.blend * 0.3) + learnedLane.score * learnedLane.blend * 0.3,
    0,
    1,
  );
  const baseDebrisData = riskZonesToDebrisData(riskZones);
  const debrisData: DebrisExternalData = {
    ...baseDebrisData,
    density: clamp(
      (baseDebrisData.density ?? 0.01) * (1 - learnedLane.blend * 0.2) +
        learnedLane.features.debrisDensity * 0.18 +
        learnedLane.features.highValueNeighborDensity * 0.14 +
        learnedLane.score * 0.12,
      0.01,
      1,
    ),
  };

  const telemetry: TelemetryBundle = {
    orbital: {
      position: referenceAsset.position,
      velocity: referenceAsset.velocity,
      position_uncertainty:
        referenceAsset.positionUncertainty +
        (summary.conjunctionRisk.recentCriticalCount > 0 ? 0.1 : 0) +
        (latest.quality?.stale ? 0.2 : latest.quality?.lowConfidence ? 0.08 : 0) +
        learnedLane.score * 0.08 +
        (learnedLane.trigger ? 0.06 : 0),
    },
    network: {
      packet_rate:
        95 +
        clamp(Math.log10((latest.coupling?.newell ?? 0) + 1) / 4, 0, 1) * 40 +
        summary.crowding.maxRiskScore * 25 +
        learnedLane.score * 16,
      connection_attempts:
        5 +
        summary.conjunctionRisk.recentCriticalCount * 2 +
        summary.crowding.unidentifiedRatio * 6 +
        learnedLane.features.highValueNeighborDensity * 4,
      entropy:
        4.5 +
        clamp(Math.abs(latest.magneticField?.y ?? 0) / 50, 0, 0.6) +
        summary.crowding.maxRiskScore * 0.4 +
        learnedLane.score * 0.25,
    },
  };

  const externalData: ExternalDataBundle = {
    space_track: {
      objects: spaceTrackObjects,
      historical_conjunction_rate: conjunctionRate,
      max_probability_of_collision: summary.conjunctionRisk.maxCollisionProbability ?? undefined,
      min_miss_distance_m: summary.conjunctionRisk.minMissDistanceM ?? undefined,
    },
    solar: buildSolarContext(recent),
    debris: debrisData,
  };

  return {
    telemetry,
    externalData,
    spaceDomainSummary: summary,
    learnedLane,
    referenceAsset: {
      source: referenceAsset.source,
      noradId: referenceAsset.noradId,
      orbitType: referenceAsset.orbitType,
    },
  };
}
