/**
 * Turing pool: proxy cache requests to a selected device.
 * Device contract: PUT/GET/DELETE /cache/:key on TURING_DEVICE_PORT.
 */

import { selectDeviceForCache, getTuringDevicePort, getDeviceById } from "./pool.js";

const CACHE_TIMEOUT_MS = 15_000;

function deviceBaseUrl(ip: string): string {
  const port = getTuringDevicePort();
  return `http://${ip}:${port}`;
}

export async function proxyCacheGet(
  key: string,
  preferredDeviceId?: string | null
): Promise<{ body: unknown; device_id: string } | null> {
  const device = selectDeviceForCache(preferredDeviceId);
  if (!device) return null;
  const base = deviceBaseUrl(device.tailscale_ip);
  const url = `${base}/cache/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CACHE_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`cache GET ${res.status}`);
    const body = await res.json();
    return { body, device_id: device.id };
  } catch {
    return null;
  }
}

export async function proxyCacheSet(
  key: string,
  value: unknown,
  ttl_sec?: number,
  preferredDeviceId?: string | null
): Promise<{ device_id: string } | null> {
  const device = selectDeviceForCache(preferredDeviceId);
  if (!device) return null;
  const base = deviceBaseUrl(device.tailscale_ip);
  const url = `${base}/cache/${encodeURIComponent(key)}`;
  const body = JSON.stringify(
    ttl_sec != null ? { value, ttl_sec } : { value }
  );
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(CACHE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`cache PUT ${res.status}`);
    return { device_id: device.id };
  } catch {
    return null;
  }
}

export async function proxyCacheDelete(
  key: string,
  preferredDeviceId?: string | null
): Promise<boolean> {
  const device = selectDeviceForCache(preferredDeviceId);
  if (!device) return false;
  const base = deviceBaseUrl(device.tailscale_ip);
  const url = `${base}/cache/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(CACHE_TIMEOUT_MS),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Resolve device base URL by id (for compute dispatcher).
 */
export function getDeviceBaseUrl(deviceId: string): string | null {
  const device = getDeviceById(deviceId);
  if (!device) return null;
  return deviceBaseUrl(device.tailscale_ip);
}
