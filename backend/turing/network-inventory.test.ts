import assert from "node:assert/strict";
import test from "node:test";
import {
  clearNetworkInventoriesForTests,
  getNetworkInventory,
  getNetworkInventorySummaries,
  recordNetworkInventory,
  sanitizeNetworkInventory,
} from "./network-inventory.js";
import { getDeviceById, getDevices, heartbeat, register, removeDevice } from "./pool.js";

process.env.TURING_DEVICE_IP_POLICY = "any";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    observed_at: new Date().toISOString(),
    mode: "passive",
    authorized: true,
    interfaces: [{ name: "tailscale0", up: true, addresses: ["100.100.1.2"], network_cidrs: ["100.100.0.0/16"] }],
    routes: [{ destination: "default", gateway: "100.100.0.1", interface: "tailscale0" }],
    neighbors: [{ address: "100.100.1.3", interface: "tailscale0", state: "reachable" }],
    overlay_peers: [{ address: "100.100.1.3", hostname: "node-b", online: true, platform: "linux", last_seen: new Date().toISOString() }],
    probes: [],
    policy: { allowed_cidrs: [], allowed_ports: [], max_targets: 0, max_probes: 0, truncated: false, errors: [] },
    ...overrides,
  };
}

test("network inventory is normalized and bounded before storage", () => {
  clearNetworkInventoriesForTests();
  const inventory = sanitizeNetworkInventory(fixture({
    interfaces: Array.from({ length: 100 }, (_, index) => ({ name: `if-${index}`, up: true, addresses: [], network_cidrs: [] })),
    policy: { allowed_cidrs: [" 100.64.0.0/10 "], allowed_ports: [22, 22, 0, 65536], max_targets: 100000, max_probes: -2, truncated: false, errors: ["x".repeat(500)] },
  }));
  assert.ok(inventory);
  assert.equal(inventory.interfaces.length, 32);
  assert.deepEqual(inventory.policy.allowed_ports, [22]);
  assert.equal(inventory.policy.max_targets, 10_000);
  assert.equal(inventory.policy.max_probes, 0);
  assert.ok(inventory.policy.errors[0]!.length <= 160);
  assert.ok(JSON.stringify(inventory).length <= 64 * 1024);
});

test("invalid inventory is rejected without affecting heartbeat health", () => {
  clearNetworkInventoriesForTests();
  const device = register({ hostname: "inventory-invalid", tailscale_ip: "192.0.2.10" });
  try {
    assert.deepEqual(heartbeat({ device_id: device.id, network_inventory: { mode: "passive" } as never }), { id: device.id, ok: true });
    assert.equal(getDeviceById(device.id)?.network_inventory_observed_at, null);
    assert.equal(getNetworkInventory(device.id), null);
  } finally {
    removeDevice(device.id);
  }
});

test("heartbeat stores inventory and exposes automation-safe freshness signals", () => {
  clearNetworkInventoriesForTests();
  const device = register({ hostname: "inventory-node", tailscale_ip: "192.0.2.11" });
  try {
    const payload = fixture({ mode: "approved", authorized: false, probes: [{ address: "100.100.1.3", port: 22, reachable: false, latency_ms: 250 }] });
    assert.deepEqual(heartbeat({ device_id: device.id, network_inventory: payload as never }), { id: device.id, ok: true });
    assert.equal(getDeviceById(device.id)?.network_inventory_observed_at, payload.observed_at);
    const stored = getNetworkInventory(device.id);
    assert.ok(stored);
    assert.equal(stored?.probes.length, 1);
    stored!.interfaces[0]!.name = "mutated-copy";
    assert.equal(getNetworkInventory(device.id)?.interfaces[0]?.name, "tailscale0");
    const summary = getNetworkInventorySummaries().find((entry) => entry.device_id === device.id);
    assert.ok(summary);
    assert.deepEqual(summary?.signals.sort(), ["active_discovery_not_authorized", "probe_results_present"]);
  } finally {
    removeDevice(device.id);
    clearNetworkInventoriesForTests();
  }
});
