/**
 * Turing pool: in-memory device registry, register, heartbeat, health.
 */

import type {
  TuringDevice,
  TuringDeviceRegistration,
  TuringHeartbeat,
  TuringDeviceStatus,
  TuringApprovalStatus,
} from "./types.js";

const DEFAULT_STALE_MIN = 5;
const DEFAULT_DEVICE_PORT = 8090;
const DEFAULT_MIN_BATTERY_PERCENT = 25;
/** Max devices in pool (0 = no cap). Env: TURING_POOL_MAX_DEVICES. */
const DEFAULT_MAX_DEVICES = 0;

function parseEnvInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getMaxDevices(): number {
  return parseEnvInt("TURING_POOL_MAX_DEVICES", DEFAULT_MAX_DEVICES);
}

function parseEnvBool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

const devices = new Map<string, TuringDevice>();
let nextIndex = 0;

/** One-time join codes: code -> expiresAt (ms). Anti-botnet: only valid code grants auto-approval. */
const joinCodes = new Map<string, number>();
const JOIN_CODE_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function randomJoinCode(length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)]!;
  }
  return s;
}
function pruneExpiredJoinCodes(): void {
  const now = Date.now();
  for (const [code, expiresAt] of joinCodes.entries()) {
    if (expiresAt <= now) joinCodes.delete(code);
  }
}

function generateId(): string {
  nextIndex += 1;
  return `turing-${Date.now().toString(36)}-${nextIndex}`;
}

function ipValid(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) || ip === "localhost";
}

function computeStatus(lastSeenIso: string, staleMinutes: number): TuringDeviceStatus {
  const last = Date.parse(lastSeenIso);
  if (!Number.isFinite(last)) return "offline";
  const ageMin = (Date.now() - last) / (60 * 1000);
  if (ageMin <= staleMinutes) return "healthy";
  if (ageMin <= staleMinutes * 3) return "stale";
  return "offline";
}

export function isTuringPoolEnabled(): boolean {
  return parseEnvBool("TURING_POOL_ENABLED", true);
}

export function getTuringDevicePort(): number {
  return parseEnvInt("TURING_DEVICE_PORT", DEFAULT_DEVICE_PORT);
}

export function getTuringStaleMinutes(): number {
  return parseEnvInt("TURING_HEARTBEAT_STALE_MIN", DEFAULT_STALE_MIN);
}

function getMinBatteryPercent(): number {
  const raw = parseEnvInt("TURING_MIN_BATTERY_PERCENT", DEFAULT_MIN_BATTERY_PERCENT);
  if (raw <= 0) return 0;
  if (raw > 100) return 100;
  return raw;
}

/**
 * Validate and consume a one-time join code. Returns true if code was valid and is now invalidated.
 */
function useJoinCode(code: string): boolean {
  const raw = (code ?? "").trim().toUpperCase();
  if (!raw) return false;
  pruneExpiredJoinCodes();
  const expiresAt = joinCodes.get(raw);
  if (expiresAt == null || expiresAt <= Date.now()) return false;
  joinCodes.delete(raw);
  return true;
}

/**
 * Generate a one-time join code (operator-only). Code is valid for JOIN_CODE_LIFETIME_MS.
 */
export function generateJoinCode(): { code: string; expires_at: string; expires_in_sec: number } {
  pruneExpiredJoinCodes();
  const code = randomJoinCode(8);
  const expiresAt = Date.now() + JOIN_CODE_LIFETIME_MS;
  joinCodes.set(code, expiresAt);
  return {
    code,
    expires_at: new Date(expiresAt).toISOString(),
    expires_in_sec: Math.floor(JOIN_CODE_LIFETIME_MS / 1000),
  };
}

/**
 * Register a new device or update existing by tailscale_ip.
 * If join_code is provided and valid, device is auto-approved; otherwise approval_status is "pending".
 * Returns the device id (existing or new).
 */
export function register(body: TuringDeviceRegistration): { id: string; created: boolean; approved: boolean } {
  const hostname = (body.hostname ?? "").trim();
  const tailscale_ip = (body.tailscale_ip ?? "").trim();
  if (!hostname || !tailscale_ip) {
    throw new Error("hostname and tailscale_ip are required");
  }
  if (!ipValid(tailscale_ip)) {
    throw new Error("tailscale_ip must be a valid IPv4 address");
  }

  const usedValidJoinCode = body.join_code ? useJoinCode(body.join_code) : false;

  const existing = Array.from(devices.values()).find((d) => d.tailscale_ip === tailscale_ip);
  if (existing) {
    existing.hostname = hostname;
    existing.ram_mb = typeof body.ram_mb === "number" && body.ram_mb >= 0 ? body.ram_mb : existing.ram_mb;
    existing.capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((c): c is string => typeof c === "string")
      : existing.capabilities;
    existing.last_seen = new Date().toISOString();
    existing.status = "healthy";
    if (usedValidJoinCode) existing.approval_status = "approved";
    return { id: existing.id, created: false, approved: existing.approval_status === "approved" };
  }

  const id = generateId();
  const now = new Date().toISOString();
  const approval_status: TuringApprovalStatus = usedValidJoinCode ? "approved" : "pending";
  const device: TuringDevice = {
    id,
    hostname,
    tailscale_ip,
    ram_mb: typeof body.ram_mb === "number" && body.ram_mb >= 0 ? body.ram_mb : null,
    ram_used_mb: null,
    capabilities: Array.isArray(body.capabilities)
      ? body.capabilities.filter((c): c is string => typeof c === "string")
      : [],
    last_seen: now,
    status: "healthy",
    load: null,
    current_jobs: null,
    approval_status,
  };
  devices.set(id, device);

  const maxDevices = getMaxDevices();
  if (maxDevices > 0 && devices.size > maxDevices) {
    const byOldest = Array.from(devices.entries()).sort(
      (a, b) => new Date(a[1].last_seen).getTime() - new Date(b[1].last_seen).getTime()
    );
    let toRemove = devices.size - maxDevices;
    for (const [devId] of byOldest) {
      if (toRemove <= 0) break;
      devices.delete(devId);
      toRemove -= 1;
    }
  }

  return { id, created: true, approved: usedValidJoinCode };
}

/**
 * Heartbeat from a device. Identify by device_id or tailscale_ip.
 */
export function heartbeat(body: TuringHeartbeat): { id: string | null; ok: boolean } {
  let device: TuringDevice | undefined;
  if (body.device_id && typeof body.device_id === "string") {
    device = devices.get(body.device_id.trim());
  }
  if (!device && body.tailscale_ip && typeof body.tailscale_ip === "string") {
    device = Array.from(devices.values()).find((d) => d.tailscale_ip === body.tailscale_ip.trim());
  }
  if (!device) {
    return { id: null, ok: false };
  }

  device.last_seen = new Date().toISOString();
  device.status = "healthy";
  if (typeof body.ram_used_mb === "number" && body.ram_used_mb >= 0) {
    device.ram_used_mb = body.ram_used_mb;
  }
  if (typeof body.load === "number" && body.load >= 0) {
    device.load = body.load;
  }
  if (typeof body.current_jobs === "number" && body.current_jobs >= 0) {
    device.current_jobs = body.current_jobs;
  }
  if (typeof body.battery_percent === "number" && Number.isFinite(body.battery_percent)) {
    const clamped = Math.max(0, Math.min(100, body.battery_percent));
    device.battery_percent = clamped;
  }
  return { id: device.id, ok: true };
}

/**
 * Get all devices with status derived from last_seen.
 */
export function getDevices(): TuringDevice[] {
  const staleMin = getTuringStaleMinutes();
  const now = new Date().toISOString();
  return Array.from(devices.values()).map((d) => {
    const status = computeStatus(d.last_seen, staleMin);
    return { ...d, status };
  });
}

/**
 * Get summary counts for shell/footer. pending = devices not yet approved.
 */
export function getSummary(): { total: number; healthy: number; stale: number; offline: number; pending: number } {
  const list = getDevices();
  let healthy = 0;
  let stale = 0;
  let offline = 0;
  let pending = 0;
  for (const d of list) {
    if (d.approval_status === "pending") pending += 1;
    if (d.status === "healthy") healthy += 1;
    else if (d.status === "stale") stale += 1;
    else offline += 1;
  }
  return { total: list.length, healthy, stale, offline, pending };
}

/**
 * Approve a device (operator). Only approved devices receive cache/compute work.
 */
export function approveDevice(deviceId: string): boolean {
  const d = devices.get(deviceId);
  if (!d) return false;
  d.approval_status = "approved";
  return true;
}

/**
 * Revoke a device (operator). Sets approval to pending so it no longer receives work.
 */
export function revokeDevice(deviceId: string): boolean {
  const d = devices.get(deviceId);
  if (!d) return false;
  d.approval_status = "pending";
  return true;
}

/**
 * Remove a device from the pool entirely (operator).
 */
export function removeDevice(deviceId: string): boolean {
  return devices.delete(deviceId);
}

/**
 * Select a device for cache operations (e.g. least ram_used_mb or round-robin).
 * Prefer devices with "cache" capability.
 */
export function selectDeviceForCache(preferredDeviceId?: string | null): TuringDevice | null {
  const minBattery = getMinBatteryPercent();
  const list = getDevices().filter((d) => {
    if (d.approval_status !== "approved") return false;
    if (d.status !== "healthy") return false;
    if (!d.capabilities.includes("cache")) return false;
    if (d.battery_percent == null) return true;
    return d.battery_percent >= minBattery;
  });
  if (list.length === 0) {
    return null;
  }
  if (preferredDeviceId) {
    const preferred = list.find((d) => d.id === preferredDeviceId);
    if (preferred) return preferred;
  }
  // Least used RAM first
  list.sort((a, b) => (a.ram_used_mb ?? 0) - (b.ram_used_mb ?? 0));
  return list[0] ?? null;
}

/**
 * Select a device for compute (inference/batch). Prefer capability and load.
 */
export function selectDeviceForCompute(
  capability: "inference" | "batch",
  preferredDeviceId?: string | null
): TuringDevice | null {
  const minBattery = getMinBatteryPercent();
  const list = getDevices().filter((d) => {
    if (d.approval_status !== "approved") return false;
    if (d.status !== "healthy") return false;
    if (!d.capabilities.includes(capability) && !d.capabilities.includes("compute")) return false;
    if (d.battery_percent == null) return true;
    return d.battery_percent >= minBattery;
  });
  if (list.length === 0) return null;
  if (preferredDeviceId) {
    const preferred = list.find((d) => d.id === preferredDeviceId);
    if (preferred) return preferred;
  }
  // Lowest load / current_jobs first
  list.sort((a, b) => (a.current_jobs ?? 0) - (b.current_jobs ?? 0));
  return list[0] ?? null;
}

/**
 * Get device by id (with current status).
 */
export function getDeviceById(id: string): TuringDevice | null {
  const d = devices.get(id);
  if (!d) return null;
  const staleMin = getTuringStaleMinutes();
  const status = computeStatus(d.last_seen, staleMin);
  return { ...d, status };
}
