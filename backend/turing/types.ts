/**
 * Turing pool: types for devices on the Tailscale VPN.
 */

export type TuringDeviceStatus = "healthy" | "stale" | "offline";
export type TuringApprovalStatus = "pending" | "approved";

export interface TuringDevice {
  id: string;
  hostname: string;
  tailscale_ip: string;
  ram_mb: number | null;
  ram_used_mb: number | null;
  /** Battery state of the device in percent [0,100]; null when unknown or device has no battery */
  battery_percent: number | null;
  capabilities: string[];
  last_seen: string; // ISO timestamp
  status: TuringDeviceStatus;
  load: number | null;
  current_jobs: number | null;
  /** Anti-botnet: only "approved" devices receive cache/compute work */
  approval_status: TuringApprovalStatus;
}

export interface TuringDeviceRegistration {
  hostname: string;
  tailscale_ip: string;
  ram_mb?: number;
  capabilities?: string[];
  /** One-time join code from web app; if valid, device is auto-approved */
  join_code?: string;
}

export interface TuringHeartbeat {
  device_id?: string;
  tailscale_ip?: string;
  ram_used_mb?: number;
  load?: number;
  current_jobs?: number;
  /** Optional battery percent [0,100]; used to avoid draining laptops too low */
  battery_percent?: number;
}

export interface TuringDevicesResponse {
  devices: TuringDevice[];
  generated_at: string;
}

export interface TuringDevicesSummaryResponse {
  total: number;
  healthy: number;
  stale: number;
  offline: number;
  pending: number; // devices awaiting approval (not yet approved)
  generated_at: string;
}
