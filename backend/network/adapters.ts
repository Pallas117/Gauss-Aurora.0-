import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  sanitizeNetworkInventory,
} from "../turing/network-inventory.js";
import type { TuringNetworkInventory, TuringNetworkPeerInventory } from "../turing/types.js";
import type {
  NetworkAdapter,
  NetworkAdapterInventory,
  NetworkAdapterNode,
  NetworkAdapterSnapshot,
} from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 128 * 1024;
const INVENTORY_TIMEOUT_MS = 5_000;
const INVENTORY_CACHE_MS = 5_000;
const TAILSCALE_MIN = 0x64400000;
const TAILSCALE_MAX = 0x647fffff;

export type NetworkInventoryProvider = () => Promise<TuringNetworkInventory>;

export interface NetworkAdapterRegistry {
  listAdapters(): NetworkAdapter[];
  discover(): Promise<NetworkAdapterSnapshot[]>;
}

function memoizeInventoryProvider(provider: NetworkInventoryProvider): NetworkInventoryProvider {
  let cached: { expiresAt: number; inventory: TuringNetworkInventory } | null = null;
  let inFlight: Promise<TuringNetworkInventory> | null = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.inventory;
    if (inFlight) return inFlight;
    inFlight = provider()
      .then((inventory) => {
        cached = { expiresAt: Date.now() + INVENTORY_CACHE_MS, inventory };
        return inventory;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256) + parts[3]!;
}

function isTailscaleAddress(address: string | null): boolean {
  if (!address) return false;
  const value = ipv4Number(address);
  return value !== null && value >= TAILSCALE_MIN && value <= TAILSCALE_MAX;
}

function localTailscaleAddress(inventory: TuringNetworkInventory): string | null {
  for (const networkInterface of inventory.interfaces) {
    for (const address of networkInterface.addresses) {
      if (isTailscaleAddress(address)) return address;
    }
  }
  return null;
}

function currentHostNode(inventory: TuringNetworkInventory): NetworkAdapterNode {
  return {
    id: "local-host",
    hostname: os.hostname() || null,
    address: localTailscaleAddress(inventory),
    platform: process.platform,
    state: "online",
    authorization: "unknown",
    last_seen: inventory.observed_at,
  };
}

function peerNode(peer: TuringNetworkPeerInventory): NetworkAdapterNode {
  return {
    id: `tailscale:${peer.address}`,
    hostname: peer.hostname,
    address: peer.address,
    platform: peer.platform,
    state: peer.online === true ? "online" : peer.online === false ? "offline" : "unknown",
    authorization: "unknown",
    last_seen: peer.last_seen,
  };
}

function publicInventory(inventory: TuringNetworkInventory): NetworkAdapterInventory {
  return {
    interfaces: inventory.interfaces,
    routes: inventory.routes,
    neighbors: inventory.neighbors,
    probes: inventory.probes,
    policy: inventory.policy,
  };
}

function stateForInventory(inventory: TuringNetworkInventory): NetworkAdapterSnapshot["state"] {
  return inventory.policy.errors.length > 0 ? "degraded" : "ready";
}

function baseSnapshot(
  inventory: TuringNetworkInventory,
  adapterId: NetworkAdapterSnapshot["adapter_id"],
  kind: NetworkAdapterSnapshot["kind"],
  label: string,
  nodes: NetworkAdapterNode[],
  signals: string[] = [],
): NetworkAdapterSnapshot {
  return {
    adapter_id: adapterId,
    kind,
    label,
    state: stateForInventory(inventory),
    observed_at: inventory.observed_at,
    host: currentHostNode(inventory),
    nodes,
    inventory: publicInventory(inventory),
    signals: [...new Set([...signals, ...inventory.policy.errors.map((error) => `collector:${error}`)])],
  };
}

function blockedSnapshot(adapter: NetworkAdapter): NetworkAdapterSnapshot {
  return {
    adapter_id: adapter.id,
    kind: adapter.kind,
    label: adapter.kind === "tailscale" ? "Tailscale overlay" : "Local host",
    state: "blocked",
    observed_at: null,
    host: {
      id: "local-host",
      hostname: os.hostname() || null,
      address: null,
      platform: process.platform,
      state: "unknown",
      authorization: "unknown",
      last_seen: null,
    },
    nodes: [],
    inventory: null,
    signals: ["collector:unavailable"],
  };
}

export function createLocalInventoryProvider(options: { scriptPath?: string } = {}): NetworkInventoryProvider {
  const scriptPath = options.scriptPath ?? join(process.cwd(), "scripts", "turing", "network-inventory.py");
  let cached: { expiresAt: number; inventory: TuringNetworkInventory } | null = null;
  let inFlight: Promise<TuringNetworkInventory> | null = null;

  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.inventory;
    if (inFlight) return inFlight;

    inFlight = execFileAsync(
      "python3",
      [scriptPath],
      {
        cwd: process.cwd(),
        timeout: INVENTORY_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: {
          ...process.env,
          TURING_NETWORK_DISCOVERY_MODE: "passive",
          TURING_NETWORK_DISCOVERY_APPROVED: "false",
        },
      },
    ).then(({ stdout }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        throw new Error("network inventory was not valid JSON");
      }
      const inventory = sanitizeNetworkInventory(parsed);
      if (!inventory) throw new Error("network inventory failed validation");
      cached = { expiresAt: Date.now() + INVENTORY_CACHE_MS, inventory };
      return inventory;
    }).finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}

export class LocalHostNetworkAdapter implements NetworkAdapter {
  readonly id = "local-host" as const;
  readonly kind = "local" as const;

  constructor(private readonly provider: NetworkInventoryProvider) {}

  async discover(): Promise<NetworkAdapterSnapshot> {
    try {
      const inventory = await this.provider();
      return baseSnapshot(inventory, this.id, this.kind, "Local host", [currentHostNode(inventory)]);
    } catch {
      return blockedSnapshot(this);
    }
  }
}

export class TailscaleOverlayNetworkAdapter implements NetworkAdapter {
  readonly id = "tailscale-overlay" as const;
  readonly kind = "tailscale" as const;

  constructor(private readonly provider: NetworkInventoryProvider) {}

  async discover(): Promise<NetworkAdapterSnapshot> {
    try {
      const inventory = await this.provider();
      const host = currentHostNode(inventory);
      const peers = inventory.overlay_peers
        .filter((peer) => isTailscaleAddress(peer.address))
        .map(peerNode);
      const signals = isTailscaleAddress(host.address)
        ? []
        : ["tailscale:local-address-not-observed"];
      return baseSnapshot(inventory, this.id, this.kind, "Tailscale overlay", [host, ...peers], signals);
    } catch {
      return blockedSnapshot(this);
    }
  }
}

export function createNetworkAdapterRegistry(
  options: { provider?: NetworkInventoryProvider; scriptPath?: string } = {},
): NetworkAdapterRegistry {
  const provider = memoizeInventoryProvider(
    options.provider ?? createLocalInventoryProvider({ scriptPath: options.scriptPath }),
  );
  const adapters: NetworkAdapter[] = [
    new LocalHostNetworkAdapter(provider),
    new TailscaleOverlayNetworkAdapter(provider),
  ];
  return {
    listAdapters: () => [...adapters],
    discover: () => Promise.all(adapters.map((adapter) => adapter.discover())),
  };
}

const defaultRegistry = createNetworkAdapterRegistry();

export function getNetworkAdapterRegistry(): NetworkAdapterRegistry {
  return defaultRegistry;
}

export async function discoverNetworkAdapters(): Promise<NetworkAdapterSnapshot[]> {
  return getNetworkAdapterRegistry().discover();
}
