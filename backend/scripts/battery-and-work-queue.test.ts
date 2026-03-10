import assert from "node:assert/strict";
import test from "node:test";
import { getBatteryGuard, parsePmsetBattery } from "./battery-and-work-queue.js";

type EnvMap = Record<string, string | undefined>;

function withEnv(overrides: EnvMap, fn: () => void): void {
  const previous: EnvMap = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("parsePmsetBattery parses AC charging state", () => {
  const sample = "Now drawing from 'AC Power'\n -InternalBattery-0\t38%; charging; (no estimate) present: true\n";
  const parsed = parsePmsetBattery(sample);
  assert.equal(parsed.percent, 38);
  assert.equal(parsed.powerSource, "ac");
  assert.equal(parsed.charging, true);
  assert.equal(parsed.status, "charging");
});

test("parsePmsetBattery parses battery discharging state", () => {
  const sample =
    "Now drawing from 'Battery Power'\n -InternalBattery-0\t72%; discharging; 3:11 remaining present: true\n";
  const parsed = parsePmsetBattery(sample);
  assert.equal(parsed.percent, 72);
  assert.equal(parsed.powerSource, "battery");
  assert.equal(parsed.charging, false);
  assert.equal(parsed.status, "discharging");
});

test("getBatteryGuard enforces higher floor while discharging", () => {
  withEnv(
    {
      BATTERY_PERCENT: "40",
      BATTERY_CHARGING: "false",
      BATTERY_POWER_SOURCE: "battery",
      ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT: undefined,
    },
    () => {
      const guard = getBatteryGuard(process.cwd(), 10);
      assert.equal(guard.baseMinSafeBatteryPercent, 10);
      assert.equal(guard.effectiveMinSafeBatteryPercent, 45);
      assert.equal(guard.isLowBattery, true);
    }
  );
});

test("getBatteryGuard uses base floor when charging", () => {
  withEnv(
    {
      BATTERY_PERCENT: "40",
      BATTERY_CHARGING: "true",
      BATTERY_POWER_SOURCE: "ac",
      ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT: "55",
    },
    () => {
      const guard = getBatteryGuard(process.cwd(), 35);
      assert.equal(guard.baseMinSafeBatteryPercent, 35);
      assert.equal(guard.effectiveMinSafeBatteryPercent, 35);
      assert.equal(guard.isLowBattery, false);
    }
  );
});

