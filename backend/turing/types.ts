/**
 * Turing pool: types for devices on the Tailscale VPN.
 */

export type TuringDeviceStatus = "healthy" | "stale" | "offline";
export type TuringApprovalStatus = "pending" | "approved";
export type TuringDeviceClass = "linux" | "server-rack" | "spacecraft";

export interface TuringNetworkInterfaceInventory {
  name: string;
  up: boolean;
  addresses: string[];
  network_cidrs: string[];
}

export interface TuringNetworkRouteInventory {
  destination: string;
  gateway: string | null;
  interface: string | null;
}

export interface TuringNetworkNeighborInventory {
  address: string;
  interface: string | null;
  state: string | null;
}

export interface TuringNetworkPeerInventory {
  address: string;
  hostname: string | null;
  online: boolean | null;
  platform: string | null;
  last_seen: string | null;
}

export interface TuringNetworkProbeInventory {
  address: string;
  port: number;
  reachable: boolean;
  latency_ms: number | null;
}

export interface TuringNetworkInventoryPolicy {
  allowed_cidrs: string[];
  allowed_ports: number[];
  max_targets: number;
  max_probes: number;
  truncated: boolean;
  errors: string[];
}

export interface TuringNetworkInventory {
  observed_at: string;
  mode: "passive" | "approved";
  authorized: boolean;
  interfaces: TuringNetworkInterfaceInventory[];
  routes: TuringNetworkRouteInventory[];
  neighbors: TuringNetworkNeighborInventory[];
  overlay_peers: TuringNetworkPeerInventory[];
  probes: TuringNetworkProbeInventory[];
  policy: TuringNetworkInventoryPolicy;
}

export interface TuringDevice {
  id: string;
  hostname: string;
  tailscale_ip: string;
  ram_mb: number | null;
  ram_used_mb: number | null;
  /** Battery state of the device in percent [0,100]; null when unknown or device has no battery */
  battery_percent: number | null;
  charging: boolean | null;
  power_source: "ac" | "battery" | "unknown" | null;
  capabilities: string[];
  last_seen: string; // ISO timestamp
  status: TuringDeviceStatus;
  load: number | null;
  current_jobs: number | null;
  /** Anti-botnet: only "approved" devices receive cache/compute work */
  approval_status: TuringApprovalStatus;
  device_class: TuringDeviceClass;
  cache_healthy: boolean | null;
  network_inventory_observed_at: string | null;
}

export interface TuringDeviceRegistration {
  hostname: string;
  tailscale_ip: string;
  ram_mb?: number;
  capabilities?: string[];
  /** One-time join code from web app; if valid, device is auto-approved */
  join_code?: string;
  device_class?: TuringDeviceClass;
  transports?: string[];
}

export interface TuringHeartbeat {
  device_id?: string;
  tailscale_ip?: string;
  ram_used_mb?: number;
  load?: number;
  current_jobs?: number;
  /** Optional battery percent [0,100]; used to avoid draining laptops too low */
  battery_percent?: number;
  charging?: boolean;
  power_source?: "ac" | "battery" | "unknown";
  network_inventory?: TuringNetworkInventory;
  cache_healthy?: boolean;
  ram_used_percent?: number;
  network_latency_ms?: number;
  network_packet_loss_percent?: number;
  network_health?: "nominal" | "degraded" | "offline";
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
