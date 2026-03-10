/**
 * Open TLE/catalog adapter for space debris risk zones (no Privateer).
 * Fetches TLE from CelesTrak or configurable URL, propagates with SGP4,
 * bins into MEO/GEO risk zones. Stub when no URL or fetch fails.
 */

const EARTH_RADIUS_KM = 6371;
const MEO_ALT_KM_MIN = 2000;
const MEO_ALT_KM_MAX = 35786;
const GEO_ALT_KM_MIN = 35786 - 500;
const GEO_ALT_KM_MAX = 35786 + 500;
const DEFAULT_TLE_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";
const DEFAULT_SATELLITES_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";
const MAX_OBJECTS_TO_PROPAGATE = 500;
const MAX_RISK_ZONES = 50;
const MAX_SATELLITE_OBJECTS = 200;

export interface RiskZone {
  id?: string;
  orbitType: "MEO" | "GEO";
  altitudeKm: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  riskScore: number;
  objectCount?: number;
}

/** Single satellite/object from TLE with position and classification. */
export interface SatelliteObject {
  noradId: string;
  name: string;
  orbitType: "LEO" | "MEO" | "GEO";
  altitudeKm: number;
  latitudeDeg: number;
  longitudeDeg: number;
  highValue: boolean;
  unidentified: boolean;
}

function getTleUrl(): string | null {
  const url = (process.env.TLE_CATALOG_URL ?? "").trim();
  if (url) return url;
  return DEFAULT_TLE_URL;
}

function getTleUrlForSatellites(): string | null {
  const url = (process.env.TLE_SATELLITES_URL ?? "").trim();
  if (url) return url;
  return getTleUrl() ?? DEFAULT_SATELLITES_URL;
}

/** Parse TLE text into 3-line blocks; returns name + line1 + line2. */
function parseTleBlocksWithNames(
  text: string
): Array<{ name: string; line1: string; line2: string }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocks: Array<{ name: string; line1: string; line2: string }> = [];
  for (let i = 0; i + 2 <= lines.length; i += 3) {
    const name = lines[i] ?? "";
    const line1 = lines[i + 1] ?? "";
    const line2 = lines[i + 2] ?? "";
    if (line1.startsWith("1 ") && line2.startsWith("2 ")) {
      blocks.push({ name, line1, line2 });
    }
  }
  return blocks;
}

/** NORAD catalog number from TLE line 1 (columns 3-7, 1-indexed). */
function noradFromLine1(line1: string): string {
  const s = line1.length >= 7 ? line1.substring(2, 7).trim() : "";
  return s || "0";
}

function getHighValueNoradIds(): Set<string> {
  const raw = (process.env.TLE_HIGH_VALUE_NORAD_IDS ?? "25544").trim();
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(ids);
}

function isUnidentifiedName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return true;
  if (/^OBJECT\s+/i.test(n)) return true;
  if (/^UNKNOWN/i.test(n)) return true;
  if (/^DEB(\s|$)/i.test(n)) return true;
  if (/^TBA$/i.test(n)) return true;
  if (/^\d+$/.test(n)) return true; // numeric-only
  return false;
}

/**
 * Parse 3-line TLE blocks (name, line1, line2). Returns array of [line1, line2].
 */
function parseTleBlocks(text: string): Array<[string, string]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocks: Array<[string, string]> = [];
  for (let i = 0; i + 2 <= lines.length; i += 3) {
    const line0 = lines[i]!;
    const line1 = lines[i + 1]!;
    const line2 = lines[i + 2]!;
    if (line1.startsWith("1 ") && line2.startsWith("2 ")) {
      blocks.push([line1, line2]);
    }
  }
  return blocks;
}

function classifyOrbit(altitudeKm: number): "MEO" | "GEO" | null {
  if (altitudeKm >= GEO_ALT_KM_MIN && altitudeKm <= GEO_ALT_KM_MAX) return "GEO";
  if (altitudeKm >= MEO_ALT_KM_MIN && altitudeKm <= MEO_ALT_KM_MAX) return "MEO";
  return null;
}

const LEO_ALT_KM_MAX = 2000;

function classifyOrbitForObject(altitudeKm: number): "LEO" | "MEO" | "GEO" | null {
  if (altitudeKm >= GEO_ALT_KM_MIN && altitudeKm <= GEO_ALT_KM_MAX) return "GEO";
  if (altitudeKm >= MEO_ALT_KM_MIN && altitudeKm <= MEO_ALT_KM_MAX) return "MEO";
  if (altitudeKm > 0 && altitudeKm < LEO_ALT_KM_MAX) return "LEO";
  return null;
}

/**
 * Fetch TLE text from URL. Returns null on failure.
 */
async function fetchTle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Propagate and bin to risk zones. Uses satellite.js (SGP4).
 */
async function propagateAndBin(
  blocks: Array<[string, string]>,
  atDate: Date
): Promise<RiskZone[]> {
  const satellite = await import("satellite.js");
  const {
    twoline2satrec,
    propagate,
    gstime,
    eciToGeodetic,
    degreesLat,
    degreesLong,
  } = satellite;
  const gmst = gstime(atDate);

  const positions: Array<{
    orbitType: "MEO" | "GEO";
    altitudeKm: number;
    longitudeDeg: number;
    latitudeDeg: number;
  }> = [];

  const capped = blocks.slice(0, MAX_OBJECTS_TO_PROPAGATE);
  for (const [line1, line2] of capped) {
    try {
      const satrec = twoline2satrec(line1, line2);
      const pv = propagate(satrec, atDate);
      if (!pv || !pv.position) continue;
      const pos = pv.position as { x: number; y: number; z: number };
      const { x, y, z } = pos;
      const radiusKm = Math.sqrt(x * x + y * y + z * z);
      const altitudeKm = radiusKm - EARTH_RADIUS_KM;
      const orbitType = classifyOrbit(altitudeKm);
      if (!orbitType) continue;
      const geodetic = eciToGeodetic(pos, gmst);
      const latitudeDeg = degreesLat(geodetic.latitude);
      const longitudeDeg = degreesLong(geodetic.longitude);
      positions.push({
        orbitType,
        altitudeKm,
        longitudeDeg,
        latitudeDeg,
      });
    } catch {
      // skip failed propagation
    }
  }

  if (positions.length === 0) return [];

  // Bin: 12 longitude bins × orbit type (MEO vs GEO); aggregate by (orbitType, lonBin)
  const LON_BINS = 12;
  const binKey = (orbit: "MEO" | "GEO", lon: number) => {
    const bin = Math.floor(((lon + 180) / 360) * LON_BINS) % LON_BINS;
    return `${orbit}-${bin}`;
  };
  const counts = new Map<string, number>();
  const sumLat = new Map<string, number>();
  const sumLon = new Map<string, number>();
  const sumAlt = new Map<string, number>();

  for (const p of positions) {
    const key = binKey(p.orbitType, p.longitudeDeg);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sumLat.set(key, (sumLat.get(key) ?? 0) + p.latitudeDeg);
    sumLon.set(key, (sumLon.get(key) ?? 0) + p.longitudeDeg);
    sumAlt.set(key, (sumAlt.get(key) ?? 0) + p.altitudeKm);
  }

  const maxCount = Math.max(...counts.values(), 1);
  const zones: RiskZone[] = [];
  for (const [key, count] of counts) {
    const n = count;
    const [orbitType, binStr] = key.split("-");
    const orbit = orbitType as "MEO" | "GEO";
    const lonBin = parseInt(binStr!, 10);
    const longitudeDeg = ((lonBin + 0.5) / LON_BINS) * 360 - 180;
    const latitudeDeg = (sumLat.get(key) ?? 0) / n;
    const altitudeKm = (sumAlt.get(key) ?? 0) / n;
    zones.push({
      orbitType: orbit,
      altitudeKm: Math.round(altitudeKm * 10) / 10,
      longitudeDeg: Math.round(longitudeDeg * 10) / 10,
      latitudeDeg: Math.round(latitudeDeg * 10) / 10,
      riskScore: Math.min(1, n / maxCount),
      objectCount: n,
    });
  }

  zones.sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  return zones.slice(0, MAX_RISK_ZONES);
}

/**
 * Propagate named TLE blocks to satellite objects with position and high-value/unidentified flags.
 */
async function propagateToObjects(
  blocks: Array<{ name: string; line1: string; line2: string }>,
  atDate: Date
): Promise<SatelliteObject[]> {
  const satellite = await import("satellite.js");
  const {
    twoline2satrec,
    propagate,
    gstime,
    eciToGeodetic,
    degreesLat,
    degreesLong,
  } = satellite;
  const gmst = gstime(atDate);
  const highValueSet = getHighValueNoradIds();
  const out: SatelliteObject[] = [];
  const capped = blocks.slice(0, MAX_SATELLITE_OBJECTS);

  for (const { name, line1, line2 } of capped) {
    try {
      const satrec = twoline2satrec(line1, line2);
      const pv = propagate(satrec, atDate);
      if (!pv || !pv.position) continue;
      const pos = pv.position as { x: number; y: number; z: number };
      const { x, y, z } = pos;
      const radiusKm = Math.sqrt(x * x + y * y + z * z);
      const altitudeKm = radiusKm - EARTH_RADIUS_KM;
      const orbitType = classifyOrbitForObject(altitudeKm);
      if (!orbitType) continue;
      const geodetic = eciToGeodetic(pos, gmst);
      const latitudeDeg = degreesLat(geodetic.latitude);
      const longitudeDeg = degreesLong(geodetic.longitude);
      const noradId = noradFromLine1(line1);
      const highValue = highValueSet.has(noradId);
      const unidentified = isUnidentifiedName(name);
      out.push({
        noradId,
        name: name.trim() || `NORAD ${noradId}`,
        orbitType,
        altitudeKm: Math.round(altitudeKm * 10) / 10,
        latitudeDeg: Math.round(latitudeDeg * 10) / 10,
        longitudeDeg: Math.round(longitudeDeg * 10) / 10,
        highValue,
        unidentified,
      });
    } catch {
      // skip failed propagation
    }
  }

  return out;
}

/**
 * Fetch satellite/object list from open TLE catalog with high-value and unidentified classification.
 * Returns empty array when URL unset or fetch fails.
 */
export async function fetchSatelliteObjects(): Promise<SatelliteObject[]> {
  const url = getTleUrlForSatellites();
  if (!url) return [];
  const text = await fetchTle(url);
  if (!text) return [];
  const blocks = parseTleBlocksWithNames(text);
  if (blocks.length === 0) return [];
  const objects = await propagateToObjects(blocks, new Date());
  return objects.slice(0, MAX_SATELLITE_OBJECTS);
}

/**
 * Fetch risk zones from open TLE catalog. Returns stub zones when URL unset or fetch fails.
 */
export async function fetchRiskZones(options?: {
  orbitTypes?: Array<"MEO" | "GEO">;
}): Promise<RiskZone[]> {
  const url = getTleUrl();
  if (!url) {
    return getStubZones();
  }
  const text = await fetchTle(url);
  if (!text) {
    return getStubZones();
  }
  const blocks = parseTleBlocks(text);
  if (blocks.length === 0) {
    return getStubZones();
  }
  const zones = await propagateAndBin(blocks, new Date());
  const filter = options?.orbitTypes;
  if (filter && filter.length > 0) {
    return zones.filter((z) => filter.includes(z.orbitType)).slice(0, MAX_RISK_ZONES);
  }
  return zones;
}

function getStubZones(): RiskZone[] {
  return [
    {
      orbitType: "GEO",
      altitudeKm: 35786,
      longitudeDeg: -100,
      latitudeDeg: 0,
      riskScore: 0.3,
      objectCount: 1,
    },
    {
      orbitType: "MEO",
      altitudeKm: 20000,
      longitudeDeg: 45,
      latitudeDeg: 0,
      riskScore: 0.2,
      objectCount: 1,
    },
  ];
}
