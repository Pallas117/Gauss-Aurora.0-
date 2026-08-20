import type {
  AuroraGridPoint,
  CanonicalSpaceWeatherPoint,
  ExogenousSignalContext,
  MMSReconVectorPoint,
  SourceStatus,
  SphericalHarmonicCoefficients,
} from "./types.js";
import type { RiskZone, SatelliteObject } from "./ssa/open-catalog-client.js";
import {
  getRiskZoneSnapshot,
  getSatelliteObjectsSnapshot,
  setRiskZoneSnapshot,
  setSatelliteObjectsSnapshot,
  type RiskZoneSnapshot,
  type SatelliteObjectsSnapshot,
} from "./ssa/space-domain-store.js";

// Keep only the recent operational window in-process. Longer history belongs in
// Supabase/Influx, where it does not compete with the 8 GB edge runtime.
const DEFAULT_MAX_CANONICAL = 4_096;
const DEFAULT_MAX_MMS = 1_024;

function getMaxCanonicalPoints(): number {
  const raw = (process.env.CANONICAL_FEED_MAX ?? "").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CANONICAL;
}

function getMaxMmsPoints(): number {
  const raw = (process.env.MMS_FEED_MAX ?? "").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MMS;
}

const canonicalFeed: CanonicalSpaceWeatherPoint[] = [];
const mmsFeed: MMSReconVectorPoint[] = [];
let sourceStatus: SourceStatus[] = [];
let auroraMap:
  | {
      timestamp: string;
      nside: number;
      grid: AuroraGridPoint[];
      harmonics: SphericalHarmonicCoefficients;
    }
  | null = null;
let exogenousContext: ExogenousSignalContext | null = null;

export function pushCanonical(point: CanonicalSpaceWeatherPoint): void {
  canonicalFeed.push(point);
  const max = getMaxCanonicalPoints();
  if (canonicalFeed.length > max) {
    canonicalFeed.shift();
  }
}

export function pushMms(point: MMSReconVectorPoint): void {
  mmsFeed.push(point);
  const max = getMaxMmsPoints();
  if (mmsFeed.length > max) {
    mmsFeed.shift();
  }
}

export function setSourceStatus(status: SourceStatus[]): void {
  sourceStatus = status;
}

export function upsertSourceStatus(statusEntry: SourceStatus): void {
  const index = sourceStatus.findIndex((entry) => entry.source === statusEntry.source);
  if (index >= 0) {
    sourceStatus[index] = {
      ...sourceStatus[index],
      ...statusEntry,
    };
    return;
  }
  sourceStatus = [...sourceStatus, statusEntry];
}

export function setAuroraMap(map: {
  timestamp: string;
  nside: number;
  grid: AuroraGridPoint[];
  harmonics: SphericalHarmonicCoefficients;
}): void {
  auroraMap = map;
}

export function getCanonicalFeed(): CanonicalSpaceWeatherPoint[] {
  return canonicalFeed;
}

export function getMmsFeed(): MMSReconVectorPoint[] {
  return mmsFeed;
}

export function getLatestCanonical(): CanonicalSpaceWeatherPoint | null {
  return canonicalFeed.length > 0 ? canonicalFeed[canonicalFeed.length - 1] : null;
}

export function getLatestMms(): MMSReconVectorPoint | null {
  return mmsFeed.length > 0 ? mmsFeed[mmsFeed.length - 1] : null;
}

export function getSourceStatus(): SourceStatus[] {
  return sourceStatus;
}

export function getAuroraMap():
  | {
      timestamp: string;
      nside: number;
      grid: AuroraGridPoint[];
      harmonics: SphericalHarmonicCoefficients;
    }
  | null {
  return auroraMap;
}

export type { RiskZoneSnapshot, SatelliteObjectsSnapshot };

export function setRiskZones(zones: RiskZone[]): void {
  setRiskZoneSnapshot(zones);
}

export function getRiskZones(): RiskZoneSnapshot | null {
  return getRiskZoneSnapshot();
}

export function setSatelliteObjects(objects: SatelliteObject[], coverage?: Parameters<typeof setSatelliteObjectsSnapshot>[1]): void {
  setSatelliteObjectsSnapshot(objects, coverage);
}

export function getSatelliteObjects(): SatelliteObjectsSnapshot | null {
  return getSatelliteObjectsSnapshot();
}

export function setExogenousContext(ctx: ExogenousSignalContext): void {
  exogenousContext = ctx;
}

export function getExogenousContext(): ExogenousSignalContext | null {
  return exogenousContext;
}
