import type { RuntimeMemoryPressureSnapshot } from "../runtime/memory-pressure.js";
import type { SpaceDomainSnapshot } from "./space-domain-store.js";

export interface SpaceDomainAvailability {
  mode: "live" | "projected" | "warming";
  lastLiveAt: string | null;
  dataAgeSeconds: number | null;
  reason: "ok" | "ingest_empty" | "ingest_stale" | "memory_suppressed";
  projectionMethod: "sgp4" | "hold" | null;
}

const MAX_PROJECTED_AGE_MS = 6 * 60 * 60 * 1000;

let cachedProjectedSnapshot: SpaceDomainSnapshot | null = null;
let cachedProjectedAt: string | null = null;
let lastLiveAt: string | null = null;

function hasLiveSpaceDomainSignal(snapshot: SpaceDomainSnapshot): boolean {
  return Boolean(
    (snapshot.riskZones?.riskZones.length ?? 0) > 0 ||
      (snapshot.satellites?.objects.length ?? 0) > 0 ||
      snapshot.conjunctions.events.length > 0,
  );
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function cloneSnapshot(snapshot: SpaceDomainSnapshot): SpaceDomainSnapshot {
  return {
    updatedAt: snapshot.updatedAt,
    riskZones: snapshot.riskZones
      ? {
          updatedAt: snapshot.riskZones.updatedAt,
          riskZones: snapshot.riskZones.riskZones.map((zone) => ({ ...zone })),
        }
      : null,
    satellites: snapshot.satellites
      ? {
          updatedAt: snapshot.satellites.updatedAt,
          objects: snapshot.satellites.objects.map((object) => ({ ...object })),
          highValue: snapshot.satellites.highValue.map((object) => ({ ...object })),
          unidentified: snapshot.satellites.unidentified.map((object) => ({ ...object })),
        }
      : null,
    conjunctions: {
      updatedAt: snapshot.conjunctions.updatedAt,
      events: snapshot.conjunctions.events.map((event) => ({ ...event })),
    },
  };
}

function ageSeconds(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

export function noteSpaceDomainSnapshot(snapshot: SpaceDomainSnapshot): void {
  if (!hasLiveSpaceDomainSignal(snapshot)) {
    return;
  }
  cachedProjectedSnapshot = cloneSnapshot(snapshot);
  cachedProjectedAt = toIsoOrNull(snapshot.updatedAt) ?? new Date().toISOString();
  lastLiveAt = cachedProjectedAt;
}

export function resolveSpaceDomainAvailability(
  snapshot: SpaceDomainSnapshot,
  memorySnapshot: RuntimeMemoryPressureSnapshot,
): {
  snapshot: SpaceDomainSnapshot;
  availability: SpaceDomainAvailability;
} {
  noteSpaceDomainSnapshot(snapshot);

  if (hasLiveSpaceDomainSignal(snapshot)) {
    const liveAt = toIsoOrNull(snapshot.updatedAt) ?? lastLiveAt ?? new Date().toISOString();
    lastLiveAt = liveAt;
    return {
      snapshot,
      availability: {
        mode: "live",
        lastLiveAt: liveAt,
        dataAgeSeconds: ageSeconds(liveAt),
        reason: "ok",
        projectionMethod: null,
      },
    };
  }

  const projectedAtMs = cachedProjectedAt ? Date.parse(cachedProjectedAt) : Number.NaN;
  const cachedProjectionFresh =
    cachedProjectedSnapshot != null &&
    Number.isFinite(projectedAtMs) &&
    Date.now() - projectedAtMs <= MAX_PROJECTED_AGE_MS;

  if (cachedProjectionFresh && cachedProjectedSnapshot) {
    return {
      snapshot: cloneSnapshot(cachedProjectedSnapshot),
      availability: {
        mode: "projected",
        lastLiveAt,
        dataAgeSeconds: ageSeconds(lastLiveAt),
        reason: memorySnapshot.level === "critical" ? "memory_suppressed" : "ingest_stale",
        projectionMethod: "hold",
      },
    };
  }

  return {
    snapshot,
    availability: {
      mode: "warming",
      lastLiveAt,
      dataAgeSeconds: ageSeconds(lastLiveAt),
      reason: memorySnapshot.level === "critical" ? "memory_suppressed" : "ingest_empty",
      projectionMethod: null,
    },
  };
}

export function resetSpaceDomainAvailabilityState(): void {
  cachedProjectedSnapshot = null;
  cachedProjectedAt = null;
  lastLiveAt = null;
}
