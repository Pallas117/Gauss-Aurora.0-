import type {
  TuringNetworkInventory,
  TuringNetworkInterfaceInventory,
  TuringNetworkNeighborInventory,
  TuringNetworkPeerInventory,
  TuringNetworkProbeInventory,
  TuringNetworkRouteInventory,
} from "./types.js";

const MAX_INVENTORY_BYTES = 64 * 1024;
const MAX_INTERFACES = 32;
const MAX_ROUTES = 256;
const MAX_NEIGHBORS = 256;
const MAX_PEERS = 256;
const MAX_PROBES = 256;
const MAX_POLICY_ITEMS = 64;
const MAX_ERRORS = 32;
const MAX_STRING = 160;
const MAX_INVENTORIES = 128;

const inventories = new Map<string, TuringNetworkInventory>();

function text(value: unknown, max = MAX_STRING): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return normalized ? normalized.slice(0, max) : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function boundedStringList(value: unknown, limit = MAX_POLICY_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => text(entry, 64)).filter((entry): entry is string => Boolean(entry)))).slice(0, limit);
}

function boundedPortList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry) => typeof entry === "number" && Number.isInteger(entry) ? entry : Number.NaN)
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 65535))).slice(0, MAX_POLICY_ITEMS);
}

function normalizeInterface(value: unknown): TuringNetworkInterfaceInventory | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const name = text(entry.name, 80);
  if (!name) return null;
  return {
    name,
    up: entry.up === true,
    addresses: boundedStringList(entry.addresses, 32),
    network_cidrs: boundedStringList(entry.network_cidrs, 32),
  };
}

function normalizeRoute(value: unknown): TuringNetworkRouteInventory | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const destination = text(entry.destination, 80);
  if (!destination) return null;
  return {
    destination,
    gateway: text(entry.gateway, 80),
    interface: text(entry.interface, 80),
  };
}

function normalizeNeighbor(value: unknown): TuringNetworkNeighborInventory | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const address = text(entry.address, 80);
  if (!address) return null;
  return { address, interface: text(entry.interface, 80), state: text(entry.state, 40) };
}

function normalizePeer(value: unknown): TuringNetworkPeerInventory | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const address = text(entry.address, 80);
  if (!address) return null;
  return {
    address,
    hostname: text(entry.hostname, 120),
    online: bool(entry.online),
    platform: text(entry.platform, 80),
    last_seen: text(entry.last_seen, 40),
  };
}

function normalizeProbe(value: unknown): TuringNetworkProbeInventory | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const address = text(entry.address, 80);
  const port = typeof entry.port === "number" && Number.isInteger(entry.port) ? entry.port : 0;
  if (!address || port < 1 || port > 65535) return null;
  const latency = typeof entry.latency_ms === "number" && Number.isFinite(entry.latency_ms)
    ? Math.max(0, Math.min(60_000, entry.latency_ms))
    : null;
  return { address, port, reachable: entry.reachable === true, latency_ms: latency };
}

function trimToSize(inventory: TuringNetworkInventory): TuringNetworkInventory {
  const clipped = { ...inventory, policy: { ...inventory.policy } };
  let trimmed = false;
  while (JSON.stringify(clipped).length > MAX_INVENTORY_BYTES) {
    trimmed = true;
    if (clipped.probes.length > 0) clipped.probes.pop();
    else if (clipped.neighbors.length > 0) clipped.neighbors.pop();
    else if (clipped.routes.length > 0) clipped.routes.pop();
    else if (clipped.overlay_peers.length > 0) clipped.overlay_peers.pop();
    else if (clipped.interfaces.length > 0) clipped.interfaces.pop();
    else if (clipped.policy.errors.length > 0) clipped.policy.errors.pop();
    else break;
  }
  if (trimmed) clipped.policy.truncated = true;
  return clipped;
}

export function sanitizeNetworkInventory(value: unknown): TuringNetworkInventory | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const observedAt = text(input.observed_at, 40);
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return null;
  const mode = input.mode === "approved" ? "approved" : input.mode === "passive" ? "passive" : null;
  if (!mode) return null;
  const policy = input.policy && typeof input.policy === "object" ? input.policy as Record<string, unknown> : {};
  const inputTruncated =
    (Array.isArray(input.interfaces) && input.interfaces.length > MAX_INTERFACES) ||
    (Array.isArray(input.routes) && input.routes.length > MAX_ROUTES) ||
    (Array.isArray(input.neighbors) && input.neighbors.length > MAX_NEIGHBORS) ||
    (Array.isArray(input.overlay_peers) && input.overlay_peers.length > MAX_PEERS) ||
    (Array.isArray(input.probes) && input.probes.length > MAX_PROBES);
  const inventory: TuringNetworkInventory = {
    observed_at: observedAt,
    mode,
    authorized: input.authorized === true,
    interfaces: (Array.isArray(input.interfaces) ? input.interfaces.slice(0, MAX_INTERFACES) : []).map(normalizeInterface).filter((entry): entry is TuringNetworkInterfaceInventory => Boolean(entry)),
    routes: (Array.isArray(input.routes) ? input.routes.slice(0, MAX_ROUTES) : []).map(normalizeRoute).filter((entry): entry is TuringNetworkRouteInventory => Boolean(entry)),
    neighbors: (Array.isArray(input.neighbors) ? input.neighbors.slice(0, MAX_NEIGHBORS) : []).map(normalizeNeighbor).filter((entry): entry is TuringNetworkNeighborInventory => Boolean(entry)),
    overlay_peers: (Array.isArray(input.overlay_peers) ? input.overlay_peers.slice(0, MAX_PEERS) : []).map(normalizePeer).filter((entry): entry is TuringNetworkPeerInventory => Boolean(entry)),
    probes: (Array.isArray(input.probes) ? input.probes.slice(0, MAX_PROBES) : []).map(normalizeProbe).filter((entry): entry is TuringNetworkProbeInventory => Boolean(entry)),
    policy: {
      allowed_cidrs: boundedStringList(policy.allowed_cidrs),
      allowed_ports: boundedPortList(policy.allowed_ports),
      max_targets: typeof policy.max_targets === "number" && Number.isInteger(policy.max_targets) ? Math.max(0, Math.min(10_000, policy.max_targets)) : 0,
      max_probes: typeof policy.max_probes === "number" && Number.isInteger(policy.max_probes) ? Math.max(0, Math.min(10_000, policy.max_probes)) : 0,
      truncated: policy.truncated === true || inputTruncated,
      errors: boundedStringList(policy.errors, MAX_ERRORS),
    },
  };
  return trimToSize(inventory);
}

export function recordNetworkInventory(deviceId: string, value: unknown): TuringNetworkInventory | null {
  const id = deviceId.trim();
  if (!id) return null;
  const inventory = sanitizeNetworkInventory(value);
  if (!inventory) return null;
  if (!inventories.has(id) && inventories.size >= MAX_INVENTORIES) {
    const oldest = Array.from(inventories.entries()).sort((left, right) => Date.parse(left[1].observed_at) - Date.parse(right[1].observed_at))[0];
    if (oldest) inventories.delete(oldest[0]);
  }
  inventories.set(id, inventory);
  return inventory;
}

export function getNetworkInventory(deviceId: string): TuringNetworkInventory | null {
  const inventory = inventories.get(deviceId.trim());
  return inventory ? structuredClone(inventory) : null;
}

export interface TuringNetworkInventorySummary {
  device_id: string;
  observed_at: string;
  mode: TuringNetworkInventory["mode"];
  authorized: boolean;
  age_seconds: number | null;
  fresh: boolean;
  counts: { interfaces: number; routes: number; neighbors: number; overlay_peers: number; probes: number };
  signals: string[];
}

function staleMinutes(): number {
  const parsed = Number.parseInt((process.env.TURING_NETWORK_INVENTORY_STALE_MIN ?? "15").trim(), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(24 * 60, parsed)) : 15;
}

export function summarizeNetworkInventory(deviceId: string, inventory: TuringNetworkInventory): TuringNetworkInventorySummary {
  const observed = Date.parse(inventory.observed_at);
  const ageSeconds = Number.isFinite(observed) ? Math.max(0, Math.floor((Date.now() - observed) / 1000)) : null;
  const fresh = ageSeconds != null && ageSeconds <= staleMinutes() * 60;
  const signals: string[] = [];
  if (!fresh) signals.push("inventory_stale");
  if (inventory.mode === "approved" && !inventory.authorized) signals.push("active_discovery_not_authorized");
  if (inventory.probes.length > 0) signals.push("probe_results_present");
  if (inventory.policy.truncated) signals.push("inventory_truncated");
  if (inventory.policy.errors.length > 0) signals.push("collector_errors");
  return {
    device_id: deviceId,
    observed_at: inventory.observed_at,
    mode: inventory.mode,
    authorized: inventory.authorized,
    age_seconds: ageSeconds,
    fresh,
    counts: {
      interfaces: inventory.interfaces.length,
      routes: inventory.routes.length,
      neighbors: inventory.neighbors.length,
      overlay_peers: inventory.overlay_peers.length,
      probes: inventory.probes.length,
    },
    signals,
  };
}

export function getNetworkInventorySummaries(): TuringNetworkInventorySummary[] {
  return Array.from(inventories.entries()).map(([deviceId, inventory]) => summarizeNetworkInventory(deviceId, inventory));
}

export function removeNetworkInventory(deviceId: string): void {
  inventories.delete(deviceId.trim());
}

export function clearNetworkInventoriesForTests(): void {
  inventories.clear();
}
