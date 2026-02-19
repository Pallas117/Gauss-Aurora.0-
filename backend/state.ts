import type {
  AuroraGridPoint,
  CanonicalSpaceWeatherPoint,
  MMSReconVectorPoint,
  SourceStatus,
  SphericalHarmonicCoefficients,
} from "./types.js";

const MAX_POINTS = 20000;
const MAX_MMS_POINTS = 5000;

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

export function pushCanonical(point: CanonicalSpaceWeatherPoint): void {
  canonicalFeed.push(point);
  if (canonicalFeed.length > MAX_POINTS) {
    canonicalFeed.shift();
  }
}

export function pushMms(point: MMSReconVectorPoint): void {
  mmsFeed.push(point);
  if (mmsFeed.length > MAX_MMS_POINTS) {
    mmsFeed.shift();
  }
}

export function setSourceStatus(status: SourceStatus[]): void {
  sourceStatus = status;
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
