import assert from "node:assert/strict";
import test from "node:test";
import {
  getDevices,
  register,
  removeDevice,
  heartbeat,
  approveDevice,
  selectDeviceForCache,
  selectDeviceForCompute,
} from "./pool.js";

test("device count never exceeds TURING_POOL_MAX_DEVICES when set", () => {
  const prev = process.env.TURING_POOL_MAX_DEVICES;
  try {
    for (const d of getDevices()) {
      removeDevice(d.id);
    }
    process.env.TURING_POOL_MAX_DEVICES = "3";

    for (let i = 0; i < 5; i += 1) {
      register({
        hostname: `host-${i}`,
        tailscale_ip: `192.168.1.${i + 1}`,
      });
    }

    const list = getDevices();
    assert.ok(list.length <= 3, `expected at most 3 devices, got ${list.length}`);
  } finally {
    if (prev !== undefined) process.env.TURING_POOL_MAX_DEVICES = prev;
    else delete process.env.TURING_POOL_MAX_DEVICES;
  }
});

test("devices below TURING_MIN_BATTERY_PERCENT are excluded from selection", () => {
  const prevMax = process.env.TURING_POOL_MAX_DEVICES;
  const prevMinBatt = process.env.TURING_MIN_BATTERY_PERCENT;
  try {
    // Clear existing devices
    for (const d of getDevices()) {
      removeDevice(d.id);
    }
    process.env.TURING_POOL_MAX_DEVICES = "0";
    process.env.TURING_MIN_BATTERY_PERCENT = "25";

    const low = register({
      hostname: "low-batt",
      tailscale_ip: "192.168.10.1",
      capabilities: ["cache", "inference"],
    });
    const high = register({
      hostname: "high-batt",
      tailscale_ip: "192.168.10.2",
      capabilities: ["cache", "inference"],
    });

    // Mark both approved and healthy with heartbeats, but different battery levels
    approveDevice(low.id);
    approveDevice(high.id);
    heartbeat({ device_id: low.id, ram_used_mb: 512, load: 0.5, current_jobs: 1, battery_percent: 20 });
    heartbeat({ device_id: high.id, ram_used_mb: 1024, load: 0.9, current_jobs: 2, battery_percent: 80 });

    const cacheDevice = selectDeviceForCache(null);
    assert.ok(cacheDevice, "expected a cache device to be selected");
    assert.equal(cacheDevice.id, high.id, "expected high-battery device to be selected for cache");

    const computeDevice = selectDeviceForCompute("inference", null);
    assert.ok(computeDevice, "expected a compute device to be selected");
    assert.equal(computeDevice.id, high.id, "expected high-battery device to be selected for compute");
  } finally {
    if (prevMax !== undefined) process.env.TURING_POOL_MAX_DEVICES = prevMax;
    else delete process.env.TURING_POOL_MAX_DEVICES;
    if (prevMinBatt !== undefined) process.env.TURING_MIN_BATTERY_PERCENT = prevMinBatt;
    else delete process.env.TURING_MIN_BATTERY_PERCENT;
    // Clean up any devices we created
    for (const d of getDevices()) {
      removeDevice(d.id);
    }
  }
});
