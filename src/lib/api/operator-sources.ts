import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import type { SourceStatus } from "@/lib/types/space-weather";

const BASE_URL = getApiBaseUrl();

export type DataSourceType = "space_weather_feed" | "mms_feed" | "telemetry_ingest" | "custom_url";
export type SatelliteHardwareType = "ground_station" | "antenna" | "telemetry_source" | "sensor";
export type SourceOverrideDecision = "primary" | "validate" | "sample" | "suspend";

export interface OperatorDataSource {
  id: string;
  name: string;
  type: DataSourceType;
  endpoint_url: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface OperatorSatelliteHardware {
  id: string;
  name: string;
  type: SatelliteHardwareType;
  data_source_id: string | null;
  connection_hint: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SourcePolicyOverrideResponse {
  sourceStatus: SourceStatus;
  persisted: boolean;
}

async function opFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...headers, ...init?.headers },
  });
}

function throwIfNotOk(res: Response, message: string): void {
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sign in required");
    if (res.status === 403) throw new Error("Operator role required");
    throw new Error(message || `HTTP ${res.status}`);
  }
}

export async function fetchDataSources(): Promise<OperatorDataSource[]> {
  const res = await opFetch("/api/ops/data-sources");
  throwIfNotOk(res, "Failed to load data sources");
  const json = await res.json();
  return json.data_sources ?? [];
}

export async function createDataSource(body: {
  name: string;
  type: DataSourceType;
  endpoint_url?: string | null;
  config?: Record<string, unknown> | null;
  enabled?: boolean;
}): Promise<OperatorDataSource> {
  const res = await opFetch("/api/ops/data-sources", {
    method: "POST",
    body: JSON.stringify(body),
  });
  throwIfNotOk(res, "Failed to create data source");
  return res.json();
}

export async function updateDataSource(
  id: string,
  body: Partial<{ name: string; type: DataSourceType; endpoint_url: string | null; config: Record<string, unknown> | null; enabled: boolean }>,
): Promise<OperatorDataSource> {
  const res = await opFetch(`/api/ops/data-sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  throwIfNotOk(res, "Failed to update data source");
  return res.json();
}

export async function deleteDataSource(id: string): Promise<void> {
  const res = await opFetch(`/api/ops/data-sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  throwIfNotOk(res, "Failed to delete data source");
}

export async function fetchSatelliteHardware(): Promise<OperatorSatelliteHardware[]> {
  const res = await opFetch("/api/ops/satellite-hardware");
  throwIfNotOk(res, "Failed to load satellite hardware");
  const json = await res.json();
  return json.satellite_hardware ?? [];
}

export async function createSatelliteHardware(body: {
  name: string;
  type: SatelliteHardwareType;
  data_source_id?: string | null;
  connection_hint?: string | null;
  enabled?: boolean;
}): Promise<OperatorSatelliteHardware> {
  const res = await opFetch("/api/ops/satellite-hardware", {
    method: "POST",
    body: JSON.stringify(body),
  });
  throwIfNotOk(res, "Failed to create satellite hardware");
  return res.json();
}

export async function updateSatelliteHardware(
  id: string,
  body: Partial<{
    name: string;
    type: SatelliteHardwareType;
    data_source_id: string | null;
    connection_hint: string | null;
    enabled: boolean;
  }>,
): Promise<OperatorSatelliteHardware> {
  const res = await opFetch(`/api/ops/satellite-hardware/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  throwIfNotOk(res, "Failed to update satellite hardware");
  return res.json();
}

export async function deleteSatelliteHardware(id: string): Promise<void> {
  const res = await opFetch(`/api/ops/satellite-hardware/${encodeURIComponent(id)}`, { method: "DELETE" });
  throwIfNotOk(res, "Failed to delete satellite hardware");
}

export async function updateSourcePolicyOverride(
  source: string,
  body: {
    overrideDecision?: SourceOverrideDecision | null;
    overrideTargetCadenceMs?: number | null;
    overrideReason?: string | null;
  },
): Promise<SourcePolicyOverrideResponse> {
  const res = await opFetch(`/api/ops/source-health/${encodeURIComponent(source)}/override`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  throwIfNotOk(res, "Failed to update source override");
  return res.json();
}
