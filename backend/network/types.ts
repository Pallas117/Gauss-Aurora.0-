import type {
  TuringNetworkInterfaceInventory,
  TuringNetworkInventory,
  TuringNetworkNeighborInventory,
  TuringNetworkPeerInventory,
  TuringNetworkProbeInventory,
  TuringNetworkRouteInventory,
} from "../turing/types.js";

export type NetworkAdapterId = "local-host" | "tailscale-overlay";
export type NetworkAdapterKind = "local" | "tailscale";
export type NetworkAdapterState = "ready" | "degraded" | "blocked";
export type NetworkNodeState = "online" | "offline" | "unknown";

export interface NetworkAdapterNode {
  id: string;
  hostname: string | null;
  address: string | null;
  platform: string | null;
  state: NetworkNodeState;
  /** Presence is observed; it is not application enrollment or work approval. */
  authorization: "unknown";
  last_seen: string | null;
}

export interface NetworkAdapterInventory {
  interfaces: TuringNetworkInterfaceInventory[];
  routes: TuringNetworkRouteInventory[];
  neighbors: TuringNetworkNeighborInventory[];
  probes: TuringNetworkProbeInventory[];
  policy: TuringNetworkInventory["policy"];
}

export interface NetworkAdapterSnapshot {
  adapter_id: NetworkAdapterId;
  kind: NetworkAdapterKind;
  label: string;
  state: NetworkAdapterState;
  observed_at: string | null;
  host: NetworkAdapterNode;
  nodes: NetworkAdapterNode[];
  inventory: NetworkAdapterInventory | null;
  signals: string[];
}

export interface NetworkAdapter {
  readonly id: NetworkAdapterId;
  readonly kind: NetworkAdapterKind;
  discover(): Promise<NetworkAdapterSnapshot>;
}
