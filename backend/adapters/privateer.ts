/**
 * Privateer-capable adapter for space debris / risk zones (Wayfinder, Crow's Nest).
 * When PRIVATEER_API_URL + credentials are set, calls their API and normalizes to RiskZone[].
 * Otherwise returns a small stub set so the contract is stable and frontend can develop against it.
 * No high-frequency polling; callers control cadence.
 */

export interface RiskZone {
  id?: string;
  orbitType: "MEO" | "GEO";
  altitudeKm: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  riskScore: number;
  objectCount?: number;
}

const STUB_ZONES: RiskZone[] = [
  {
    orbitType: "GEO",
    altitudeKm: 35786,
    longitudeDeg: -100,
    latitudeDeg: 0,
    riskScore: 0.35,
    objectCount: 1,
  },
  {
    orbitType: "MEO",
    altitudeKm: 20200,
    longitudeDeg: 45,
    latitudeDeg: 0,
    riskScore: 0.25,
    objectCount: 1,
  },
  {
    orbitType: "GEO",
    altitudeKm: 35790,
    longitudeDeg: 120,
    latitudeDeg: 2,
    riskScore: 0.2,
    objectCount: 1,
  },
];

function getPrivateerConfig(): { url: string; token: string } | null {
  const url = (process.env.PRIVATEER_API_URL ?? "").trim();
  const token = (process.env.PRIVATEER_API_KEY ?? process.env.PRIVATEER_API_TOKEN ?? "").trim();
  if (!url || !token) return null;
  return { url, token };
}

/**
 * Normalize a Privateer API response to RiskZone[].
 * Assumes API returns something like { riskZones?: Array<{ orbit_type?, altitude_km?, lon?, lat?, risk_score?, object_count?, id? }> }.
 */
function normalizePrivateerResponse(body: unknown, filterOrbitTypes?: Array<"MEO" | "GEO">): RiskZone[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { riskZones?: unknown[]; zones?: unknown[] }).riskZones
    ?? (body as { zones?: unknown[] }).zones
    ?? [];
  if (!Array.isArray(raw)) return [];

  const zones: RiskZone[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const orbitTypeRaw = o.orbit_type ?? o.orbitType ?? o.orbit;
    const orbitType =
      String(orbitTypeRaw).toUpperCase() === "GEO"
        ? "GEO"
        : String(orbitTypeRaw).toUpperCase() === "MEO"
          ? "MEO"
          : null;
    if (!orbitType) continue;
    if (filterOrbitTypes?.length && !filterOrbitTypes.includes(orbitType)) continue;

    const altitudeKm = Number(o.altitude_km ?? o.altitudeKm ?? o.altitude ?? 0);
    const longitudeDeg = o.longitude_deg ?? o.longitudeDeg ?? o.lon ?? o.longitude;
    const latitudeDeg = o.latitude_deg ?? o.latitudeDeg ?? o.lat ?? o.latitude;
    const riskScore = Math.max(0, Math.min(1, Number(o.risk_score ?? o.riskScore ?? o.risk ?? 0.5)));
    const objectCount = typeof o.object_count === "number" ? o.object_count : typeof o.objectCount === "number" ? o.objectCount : undefined;
    const id = typeof o.id === "string" ? o.id : undefined;

    zones.push({
      id,
      orbitType,
      altitudeKm: Number.isFinite(altitudeKm) ? altitudeKm : orbitType === "GEO" ? 35786 : 20000,
      longitudeDeg: typeof longitudeDeg === "number" ? longitudeDeg : undefined,
      latitudeDeg: typeof latitudeDeg === "number" ? latitudeDeg : undefined,
      riskScore,
      objectCount,
    });
  }
  return zones.slice(0, 50);
}

/**
 * Fetch risk zones from Privateer API. When PRIVATEER_API_URL and credentials are not set, returns stub zones.
 */
export async function fetchPrivateerRiskZones(options?: {
  orbitTypes?: Array<"MEO" | "GEO">;
}): Promise<RiskZone[]> {
  const config = getPrivateerConfig();
  if (!config) {
    return STUB_ZONES;
  }

  try {
    const path = "/risk-zones";
    const url = config.url.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
    });
    if (!res.ok) {
      return STUB_ZONES;
    }
    const body = (await res.json()) as unknown;
    const zones = normalizePrivateerResponse(body, options?.orbitTypes);
    return zones.length > 0 ? zones : STUB_ZONES;
  } catch {
    return STUB_ZONES;
  }
}
