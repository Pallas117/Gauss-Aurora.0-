import type { ConjunctionRecord } from "./conjunction-interop.js";
import type { RiskZone, SatelliteCatalogCoverage, SatelliteObject } from "./open-catalog-client.js";
import { noteSpaceDomainSnapshot, resetSpaceDomainAvailabilityState } from "./availability.js";

const MAX_RISK_ZONES = 50;
const MAX_SATELLITE_OBJECTS = 200;
const MAX_CONJUNCTION_EVENTS = 200;

export interface RiskZoneSnapshot {
  riskZones: RiskZone[];
  updatedAt: string;
}

export interface SatelliteObjectsSnapshot {
  objects: SatelliteObject[];
  highValue: SatelliteObject[];
  unidentified: SatelliteObject[];
  updatedAt: string;
  coverage: SatelliteCatalogCoverage;
}

export interface ConjunctionEventsSnapshot {
  events: ConjunctionRecord[];
  updatedAt: string | null;
}

export interface SpaceDomainSnapshot {
  updatedAt: string | null;
  riskZones: RiskZoneSnapshot | null;
  satellites: SatelliteObjectsSnapshot | null;
  conjunctions: ConjunctionEventsSnapshot;
}

let riskZoneSnapshot: RiskZoneSnapshot | null = null;
let satelliteObjectsSnapshot: SatelliteObjectsSnapshot | null = null;
let conjunctionEvents: ConjunctionRecord[] = [];
let conjunctionUpdatedAt: string | null = null;

function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function setRiskZoneSnapshot(zones: RiskZone[]): void {
  riskZoneSnapshot = {
    riskZones: zones.slice(0, MAX_RISK_ZONES),
    updatedAt: new Date().toISOString(),
  };
  noteSpaceDomainSnapshot(getSpaceDomainSnapshot());
}

export function getRiskZoneSnapshot(): RiskZoneSnapshot | null {
  return riskZoneSnapshot;
}

export function setSatelliteObjectsSnapshot(objects: SatelliteObject[], coverage?: SatelliteCatalogCoverage): void {
  const capped = objects.slice(0, MAX_SATELLITE_OBJECTS);
  const observedAt = new Date().toISOString();
  const objectClassCounts = capped.reduce((counts, object) => {
    const objectClass = object.objectClass ?? (object.unidentified ? "unknown" : "spacecraft");
    counts[objectClass] += 1;
    return counts;
  }, { spacecraft: 0, rocket_body: 0, debris: 0, unknown: 0 } as SatelliteCatalogCoverage["objectClassCounts"]);
  satelliteObjectsSnapshot = {
    objects: capped,
    highValue: capped.filter((object) => object.highValue),
    unidentified: capped.filter((object) => object.unidentified),
    updatedAt: observedAt,
    coverage: coverage ?? {
      sourceUrls: [],
      sourceFailures: [],
      complete: false,
      truncated: capped.length >= MAX_SATELLITE_OBJECTS,
      catalogObjects: objects.length,
      parsedObjects: objects.length,
      propagatedObjects: objects.length,
      returnedObjects: capped.length,
      objectLimit: MAX_SATELLITE_OBJECTS,
      fetchedAt: observedAt,
      objectClassCounts,
    },
  };
  noteSpaceDomainSnapshot(getSpaceDomainSnapshot());
}

export function getSatelliteObjectsSnapshot(): SatelliteObjectsSnapshot | null {
  return satelliteObjectsSnapshot;
}

export function appendConjunctionRecord(record: ConjunctionRecord): void {
  conjunctionEvents.push(record);
  if (conjunctionEvents.length > MAX_CONJUNCTION_EVENTS) {
    conjunctionEvents = conjunctionEvents.slice(conjunctionEvents.length - MAX_CONJUNCTION_EVENTS);
  }
  conjunctionUpdatedAt = record.ingestedAt ?? new Date().toISOString();
  noteSpaceDomainSnapshot(getSpaceDomainSnapshot());
}

export function setConjunctionRecords(records: ConjunctionRecord[]): void {
  const sorted = [...records].sort((a, b) => Date.parse(a.ingestedAt) - Date.parse(b.ingestedAt));
  conjunctionEvents = sorted.slice(-MAX_CONJUNCTION_EVENTS);
  conjunctionUpdatedAt = conjunctionEvents[conjunctionEvents.length - 1]?.ingestedAt ?? null;
  noteSpaceDomainSnapshot(getSpaceDomainSnapshot());
}

export function getConjunctionEvents(limit = MAX_CONJUNCTION_EVENTS): ConjunctionRecord[] {
  const bounded = Math.max(1, Math.min(limit, MAX_CONJUNCTION_EVENTS));
  return conjunctionEvents.slice(Math.max(0, conjunctionEvents.length - bounded)).reverse();
}

export function getConjunctionEventsSnapshot(limit = MAX_CONJUNCTION_EVENTS): ConjunctionEventsSnapshot {
  return {
    events: getConjunctionEvents(limit),
    updatedAt: conjunctionUpdatedAt,
  };
}

export function getSpaceDomainSnapshot(options?: {
  conjunctionLimit?: number;
}): SpaceDomainSnapshot {
  const conjunctions = getConjunctionEventsSnapshot(options?.conjunctionLimit);
  return {
    updatedAt: newestIso(
      newestIso(riskZoneSnapshot?.updatedAt ?? null, satelliteObjectsSnapshot?.updatedAt ?? null),
      conjunctions.updatedAt,
    ),
    riskZones: riskZoneSnapshot,
    satellites: satelliteObjectsSnapshot,
    conjunctions,
  };
}

export function resetSpaceDomainStore(): void {
  riskZoneSnapshot = null;
  satelliteObjectsSnapshot = null;
  conjunctionEvents = [];
  conjunctionUpdatedAt = null;
  resetSpaceDomainAvailabilityState();
}
