/**
 * InfluxDB client for bxr stack. Query canonical telemetry when INFLUXDB_URL and token are set.
 */

import { InfluxDB, flux } from "@influxdata/influxdb-client";

let queryApi: ReturnType<InfluxDB["getQueryApi"]> | null = null;

function getConfig(): { url: string; token: string; org: string; bucket: string } | null {
  const url = (process.env.INFLUXDB_URL ?? "").trim();
  const token = (process.env.INFLUXDB_TOKEN ?? "").trim();
  const org = (process.env.INFLUXDB_ORG ?? "gauss").trim();
  const bucket = (process.env.INFLUXDB_BUCKET ?? "telemetry").trim();
  if (!url || !token) return null;
  return { url, token, org, bucket };
}

function ensureQueryApi(): ReturnType<InfluxDB["getQueryApi"]> | null {
  const config = getConfig();
  if (!config) return null;
  if (queryApi) return queryApi;
  const client = new InfluxDB({ url: config.url, token: config.token });
  queryApi = client.getQueryApi(config.org);
  return queryApi;
}

export interface CanonicalPointFromInflux {
  timestamp: string;
  speed: number;
  density: number;
  bz: number;
}

/** Query canonical points within lookback window (ms), return up to limit points. */
export async function queryCanonicalRange(
  lookbackMs: number,
  limit: number,
): Promise<CanonicalPointFromInflux[]> {
  const api = ensureQueryApi();
  const config = getConfig();
  if (!api || !config) return [];
  const start = lookbackMs <= 0 ? "-1h" : `-${Math.round(lookbackMs / 1000)}s`;

  const query = flux`from(bucket: "${config.bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r["_measurement"] == "canonical")
  |> filter(fn: (r) => r["_field"] == "speed" or r["_field"] == "density" or r["_field"] == "bz")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: ${limit * 3})`;
  try {
    return await collectCanonicalRows(api, query, limit);
  } catch (err) {
    console.warn("[influxdb] query canonical range failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function collectCanonicalRows(
  api: ReturnType<InfluxDB["getQueryApi"]>,
  query: ReturnType<typeof flux>,
  limit: number,
): Promise<CanonicalPointFromInflux[]> {
  const rows: CanonicalPointFromInflux[] = [];
  const byTime = new Map<string, { _time: string; speed?: number; density?: number; bz?: number }>();
  for await (const record of api.iterateRows(query)) {
    const t = record.getTime()?.toISOString?.() ?? String(record.getValue("_time"));
    const field = String(record.getField());
    const value = record.getValue();
    let row = byTime.get(t);
    if (!row) {
      row = { _time: t };
      byTime.set(t, row);
    }
    if (field === "speed") row.speed = Number(value);
    else if (field === "density") row.density = Number(value);
    else if (field === "bz") row.bz = Number(value);
  }
  for (const row of byTime.values()) {
    if (row._time && [row.speed, row.density, row.bz].every((v) => v !== undefined && Number.isFinite(v))) {
      rows.push({
        timestamp: row._time,
        speed: row.speed ?? 0,
        density: row.density ?? 0,
        bz: row.bz ?? 0,
      });
    }
  }
  rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return rows.slice(0, limit);
}

export async function queryCanonicalLatest(limit: number): Promise<CanonicalPointFromInflux[]> {
  const api = ensureQueryApi();
  const config = getConfig();
  if (!api || !config) return [];

  const query = flux`from(bucket: "${config.bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r["_measurement"] == "canonical")
  |> filter(fn: (r) => r["_field"] == "speed" or r["_field"] == "density" or r["_field"] == "bz")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: ${limit * 3})`;
  try {
    return await collectCanonicalRows(api, query, limit);
  } catch (err) {
    console.warn("[influxdb] query canonical failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export function isInfluxConfigured(): boolean {
  return getConfig() !== null;
}

/** Build a minimal canonical point for API response from Influx row (speed, density, bz). */
export function toMinimalCanonicalPoint(row: CanonicalPointFromInflux): Record<string, unknown> {
  const speed = Number(row.speed) || 400;
  const density = Number(row.density) || 5;
  const bz = Number(row.bz) ?? 0;
  const bt = Math.sqrt(3 * 3 + bz * bz);
  return {
    timestamp: row.timestamp,
    source: "fusion",
    rho: density,
    velocity: { x: -speed, y: 0, z: 0, magnitude: speed },
    magneticField: { x: 3, y: -1, z: bz, bt },
    electricField: { x: 0, y: bz * 0.1, z: 0, ey: bz * 0.1 },
    solarWind: { speed, density, dynamicPressure: 1.67e-6 * density * speed * speed * 1e-6 },
    indices: { kp: 2, dst: -20 },
    coupling: { newell: 1000, epsilon: 1e11 },
    propagation: { l1DelaySeconds: 3600, etaEarthArrival: new Date(Date.now() + 3600 * 1000).toISOString() },
    alerts: { stormTier: "quiet", reason: "influx" },
    quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
    uncertainty: {
      speed: { lower: speed * 0.92, upper: speed * 1.08, sigma: speed * 0.08 },
      density: { lower: density * 0.88, upper: density * 1.12, sigma: density * 0.12 },
      bz: { lower: bz - 0.5, upper: bz + 0.5, sigma: 0.5 },
    },
  };
}
