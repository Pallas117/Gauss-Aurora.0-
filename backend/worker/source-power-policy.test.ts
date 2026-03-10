import assert from "node:assert/strict";
import test from "node:test";

import { resolveSourcePowerPolicies } from "./source-power-policy.js";
import type { CanonicalSpaceWeatherPoint, SourceStatus } from "../types.js";

function baseStatus(): SourceStatus[] {
  return [
    {
      source: "noaa-swpc",
      lastSeen: "2026-03-07T10:00:00.000Z",
      latencySeconds: 20,
      healthy: true,
      message: "ok",
    },
    {
      source: "esa-hapi",
      lastSeen: "2026-03-07T10:00:00.000Z",
      latencySeconds: 60,
      healthy: true,
      message: "ok",
    },
    {
      source: "mms-cdaweb",
      lastSeen: "2026-03-07T10:00:00.000Z",
      latencySeconds: 90,
      healthy: true,
      message: "ok",
    },
    {
      source: "mms-lasp",
      lastSeen: "2026-03-07T10:00:00.000Z",
      latencySeconds: 120,
      healthy: true,
      message: "ok",
    },
    {
      source: "jaxa-erg",
      lastSeen: "2026-03-07T10:00:00.000Z",
      latencySeconds: 3600,
      healthy: true,
      message: "catalog reachable",
    },
  ];
}

function canonicalPoint(
  stormTier: CanonicalSpaceWeatherPoint["alerts"]["stormTier"],
): CanonicalSpaceWeatherPoint {
  return {
    timestamp: "2026-03-07T10:00:00.000Z",
    source: "fusion",
    rho: 7.5,
    velocity: { x: -420, y: 18, z: -9, magnitude: 445.2 },
    magneticField: { x: 2.3, y: -1.1, z: stormTier === "severe" ? -8.2 : -3.2, bt: 6.2 },
    electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
    solarWind: { speed: 445.2, density: 7.5, dynamicPressure: 2.8 },
    indices: { kp: stormTier === "severe" ? 7 : 3, dst: stormTier === "severe" ? -110 : -30 },
    coupling: { newell: stormTier === "severe" ? 19400 : 9000, epsilon: 812345 },
    propagation: {
      l1DelaySeconds: 1680,
      etaEarthArrival: "2026-03-07T10:28:00.000Z",
    },
    alerts: { stormTier, reason: "test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 408, upper: 482, sigma: 18.5 },
      density: { lower: 6.9, upper: 8.1, sigma: 0.6 },
      bz: { lower: -6.2, upper: -4.6, sigma: 0.8 },
    },
    diagnostics: {
      shueR0Re: 8.77,
      alfvenSpeedKmS: 410,
      clockAngleRad: -2.94,
    },
  };
}

test("quiet low-power policy demotes opportunistic feeds", () => {
  const policies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("quiet"),
    sourceStatus: baseStatus(),
    powerProfile: "low-power",
    cadenceScale: 2,
    airGapped: false,
    burstMode: false,
  });

  assert.equal(policies["noaa-swpc"].decision, "primary");
  assert.equal(policies["esa-hapi"].decision, "validate");
  assert.equal(policies["mms-cdaweb"].decision, "sample");
  assert.equal(policies["mms-lasp"].decision, "suspend");
  assert.equal(policies["jaxa-erg"].decision, "suspend");
  assert.equal(policies["esa-hapi"].targetCadenceMs, 60_000);
  assert.equal(policies["mms-cdaweb"].targetCadenceMs, 40_000);
});

test("severe burst policy promotes MMS feeds despite power pressure", () => {
  const degradedNoaa = baseStatus().map((entry) =>
    entry.source === "noaa-swpc"
      ? { ...entry, healthy: false, latencySeconds: 1200, message: "stale" }
      : entry,
  );

  const policies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("severe"),
    sourceStatus: degradedNoaa,
    powerProfile: "low-power",
    cadenceScale: 2.5,
    airGapped: false,
    burstMode: true,
  });

  assert.equal(policies["esa-hapi"].decision, "primary");
  assert.equal(policies["mms-cdaweb"].decision, "primary");
  assert.equal(policies["mms-lasp"].decision, "primary");
  assert.equal(policies["jaxa-erg"].decision, "suspend");
  assert.ok(policies["mms-lasp"].utilityScore > policies["jaxa-erg"].utilityScore);
});

test("air-gapped policy suspends all external sources", () => {
  const policies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 60_000,
      "esa-hapi": 10_000,
      "jaxa-erg": 60_000,
      "mms-cdaweb": 5_000,
      "mms-lasp": 60_000,
      "model-nowcast": 5_000,
    },
    latestCanonical: canonicalPoint("warning"),
    sourceStatus: baseStatus(),
    powerProfile: "nominal",
    cadenceScale: 1,
    airGapped: true,
    burstMode: true,
  });

  assert.equal(policies["noaa-swpc"].decision, "suspend");
  assert.equal(policies["mms-cdaweb"].decision, "suspend");
  assert.equal(policies["jaxa-erg"].targetCadenceMs, null);
});

test("observed runtime cost reduces utility for expensive sources under pressure", () => {
  const costlyStatus = baseStatus().map((entry) =>
    entry.source === "esa-hapi"
      ? {
          ...entry,
          observedCostScore: 0.92,
          avgFetchDurationMs: 5200,
          avgCpuMs: 110,
          avgPayloadKb: 220,
          sampleCount: 8,
        }
      : entry,
  );

  const lowCostStatus = baseStatus().map((entry) =>
    entry.source === "esa-hapi"
      ? {
          ...entry,
          observedCostScore: 0.08,
          avgFetchDurationMs: 140,
          avgCpuMs: 6,
          avgPayloadKb: 12,
          sampleCount: 8,
        }
      : entry,
  );

  const costlyPolicies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("quiet"),
    sourceStatus: costlyStatus,
    powerProfile: "low-power",
    cadenceScale: 2,
    airGapped: false,
    burstMode: false,
  });

  const lowCostPolicies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("quiet"),
    sourceStatus: lowCostStatus,
    powerProfile: "low-power",
    cadenceScale: 2,
    airGapped: false,
    burstMode: false,
  });

  assert.ok(costlyPolicies["esa-hapi"].utilityScore < lowCostPolicies["esa-hapi"].utilityScore);
  assert.ok(
    (costlyPolicies["esa-hapi"].targetCadenceMs ?? Number.POSITIVE_INFINITY) >=
      (lowCostPolicies["esa-hapi"].targetCadenceMs ?? 0),
  );
});

test("operator override wins over adaptive source power policy", () => {
  const overriddenStatus = baseStatus().map((entry) =>
    entry.source === "mms-lasp"
      ? {
          ...entry,
          overrideDecision: "primary" as const,
          overrideTargetCadenceMs: 15_000,
          overrideReason: "incident pin",
        }
      : entry,
  );

  const policies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("quiet"),
    sourceStatus: overriddenStatus,
    powerProfile: "low-power",
    cadenceScale: 2,
    airGapped: false,
    burstMode: false,
  });

  assert.equal(policies["mms-lasp"].decision, "primary");
  assert.equal(policies["mms-lasp"].targetCadenceMs, 15_000);
  assert.match(policies["mms-lasp"].reason, /override=primary/);
});

test("constrained memory demotes opportunistic feeds before ceiling breach", () => {
  const policies = resolveSourcePowerPolicies({
    activeCadenceMsBySource: {
      "noaa-swpc": 120_000,
      "esa-hapi": 30_000,
      "jaxa-erg": 120_000,
      "mms-cdaweb": 10_000,
      "mms-lasp": 120_000,
      "model-nowcast": 20_000,
    },
    latestCanonical: canonicalPoint("quiet"),
    sourceStatus: baseStatus(),
    powerProfile: "nominal",
    cadenceScale: 1,
    airGapped: false,
    burstMode: false,
    memoryPressure: "constrained",
  });

  assert.equal(policies["noaa-swpc"].decision, "primary");
  assert.equal(policies["esa-hapi"].decision, "validate");
  assert.equal(policies["mms-cdaweb"].decision, "validate");
  assert.equal(policies["mms-lasp"].decision, "sample");
  assert.match(policies["mms-lasp"].reason, /memory=constrained/);
});
