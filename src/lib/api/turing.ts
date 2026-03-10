import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import {
  parseTuringDevicesResponse,
  parseTuringDevicesSummaryResponse,
  parseTuringJoinCodeResponse,
  type TuringDevicesResponse,
  type TuringDevicesSummaryResponse,
  type TuringJoinCodeResponse,
} from "@/lib/contracts/turing";
import { fetchWithResilience } from "@/lib/network/resilient-fetch";

const BASE_URL = getApiBaseUrl();

export async function fetchTuringDevices(): Promise<TuringDevicesResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "turing devices",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 503) {
      throw new Error("Turing pool is disabled");
    }
    if (response.status === 401) {
      throw new Error("Sign in required to view Turing devices.");
    }
    throw new Error(`Turing devices HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseTuringDevicesResponse(json);
}

export async function fetchTuringDevicesSummary(): Promise<TuringDevicesSummaryResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/summary`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "turing summary",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 503) {
      throw new Error("Turing pool is disabled");
    }
    if (response.status === 401) {
      throw new Error("Sign in required");
    }
    throw new Error(`Turing summary HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseTuringDevicesSummaryResponse(json);
}

export async function createTuringJoinCode(): Promise<TuringJoinCodeResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/join-code`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
    },
    {
      scope: "turing join code",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 503) throw new Error("Turing pool is disabled");
    if (response.status === 401) throw new Error("Sign in required");
    if (response.status === 403) throw new Error("Operator role required to generate join codes");
    throw new Error(`Join code HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseTuringJoinCodeResponse(json);
}

export async function approveTuringDevice(deviceId: string): Promise<void> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/${encodeURIComponent(deviceId)}/approve`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
    },
    {
      scope: "approve turing device",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Device not found");
    if (response.status === 403) throw new Error("Operator role required");
    throw new Error(`Approve device HTTP ${response.status}`);
  }
}

export async function revokeTuringDevice(deviceId: string): Promise<void> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/${encodeURIComponent(deviceId)}/revoke`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
    },
    {
      scope: "revoke turing device",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Device not found");
    if (response.status === 403) throw new Error("Operator role required");
    throw new Error(`Revoke device HTTP ${response.status}`);
  }
}

export async function removeTuringDevice(deviceId: string): Promise<void> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/${encodeURIComponent(deviceId)}`,
    {
      method: "DELETE",
      headers: await getAuthHeaders(),
    },
    {
      scope: "remove turing device",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Device not found");
    if (response.status === 403) throw new Error("Operator role required");
    throw new Error(`Remove device HTTP ${response.status}`);
  }
}

export interface TuringDeviceHealthResponse {
  device_id: string;
  ok: boolean;
  ram_used_mb?: number | null;
  load?: number | null;
}

export async function fetchTuringDeviceHealth(deviceId: string): Promise<TuringDeviceHealthResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/${encodeURIComponent(deviceId)}/health`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "turing device health",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Device not found");
    if (response.status === 502) throw new Error("Device health unreachable");
    if (response.status === 403) throw new Error("Operator role required");
    throw new Error(`Device health HTTP ${response.status}`);
  }
  return response.json() as Promise<TuringDeviceHealthResponse>;
}

export interface TuringDeviceHealResponse {
  device_id: string;
  ok: boolean;
  message?: string;
  expired_cleared?: number;
}

export async function triggerTuringDeviceHeal(deviceId: string): Promise<TuringDeviceHealResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/turing/devices/${encodeURIComponent(deviceId)}/heal`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
    },
    {
      scope: "turing device heal",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("Device not found");
    if (response.status === 502) throw new Error("Device heal unreachable");
    if (response.status === 403) throw new Error("Operator role required");
    throw new Error(`Device heal HTTP ${response.status}`);
  }
  return response.json() as Promise<TuringDeviceHealResponse>;
}
