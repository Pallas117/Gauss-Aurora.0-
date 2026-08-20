import assert from "node:assert/strict";
import test from "node:test";
import {
  createNetworkAdapterRegistry,
  type NetworkInventoryProvider,
} from "./adapters.js";

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    observed_at: "2026-08-20T00:00:00.000Z",
    mode: "passive",
    authorized: false,
    interfaces: [
      { name: "utun9", up: true, addresses: ["100.88.86.98"], network_cidrs: ["100.64.0.0/10"] },
    ],
    routes: [{ destination: "default", gateway: null, interface: "utun9" }],
    neighbors: [],
    overlay_peers: [
      { address: "100.107.156.105", hostname: "talos", online: true, platform: "linux", last_seen: "2026-08-20T00:00:00.000Z" },
      { address: "192.0.2.44", hostname: "non-tailnet", online: true, platform: "linux", last_seen: null },
    ],
    probes: [],
    policy: { allowed_cidrs: [], allowed_ports: [], max_targets: 0, max_probes: 0, truncated: false, errors: [] },
    ...overrides,
  } as never;
}

test("registry exposes local and Tailscale adapters from one bounded inventory read", async () => {
  let reads = 0;
  const provider: NetworkInventoryProvider = async () => {
    reads += 1;
    return inventory();
  };
  const snapshots = await createNetworkAdapterRegistry({ provider }).discover();

  assert.deepEqual(snapshots.map((snapshot) => snapshot.adapter_id), ["local-host", "tailscale-overlay"]);
  assert.equal(reads, 1);
  assert.equal(snapshots[0]?.host.address, "100.88.86.98");
  assert.deepEqual(snapshots[1]?.nodes.map((node) => node.address), ["100.88.86.98", "100.107.156.105"]);
  assert.equal(snapshots[1]?.nodes[1]?.authorization, "unknown");
});

test("Tailscale adapter preserves degraded collector evidence and does not enable probes", async () => {
  const provider: NetworkInventoryProvider = async () => inventory({
    policy: { allowed_cidrs: [], allowed_ports: [], max_targets: 0, max_probes: 0, truncated: false, errors: ["tailscale:exit_1"] },
  });
  const snapshot = (await createNetworkAdapterRegistry({ provider }).discover())[1]!;

  assert.equal(snapshot.state, "degraded");
  assert.ok(snapshot.signals.includes("collector:tailscale:exit_1"));
  assert.equal(snapshot.inventory?.probes.length, 0);
});

test("adapter discovery fails closed when the collector is unavailable", async () => {
  const provider: NetworkInventoryProvider = async () => {
    throw new Error("collector unavailable");
  };
  const snapshots = await createNetworkAdapterRegistry({ provider }).discover();

  assert.deepEqual(snapshots.map((snapshot) => snapshot.state), ["blocked", "blocked"]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.signals), [["collector:unavailable"], ["collector:unavailable"]]);
});
