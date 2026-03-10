import assert from "node:assert/strict";
import test from "node:test";

import { buildPlannerTrendSummary } from "./planner-context.js";
import type { CanonicalSpaceWeatherPoint, SourceStatus } from "./types.js";

function makePoint(
  timestamp: string,
  overrides?: Partial<CanonicalSpaceWeatherPoint>,
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 7.5,
    velocity: { x: -420, y: 18, z: -9, magnitude: 445.2 },
    magneticField: { x: 2.3, y: -1.1, z: -3.5, bt: 6.2 },
    electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
    solarWind: { speed: 430, density: 6.5, dynamicPressure: 2.8 },
    indices: { kp: 3, dst: -32 },
    coupling: { newell: 9000, epsilon: 812345 },
    propagation: {
      l1DelaySeconds: 1680,
      etaEarthArrival: "2026-03-05T12:28:00.000Z",
    },
    alerts: { stormTier: "quiet", reason: "baseline" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 408, upper: 482, sigma: 18.5 },
      density: { lower: 6.1, upper: 7.1, sigma: 0.6 },
      bz: { lower: -4.2, upper: -2.6, sigma: 0.8 },
    },
    diagnostics: {
      shueR0Re: 8.77,
      alfvenSpeedKmS: 410,
      clockAngleRad: -2.94,
    },
    ...overrides,
  };
}

test("buildPlannerTrendSummary summarizes recent trend shifts and operational flags", () => {
  const sequence = [
    makePoint("2026-03-05T12:00:00.000Z"),
    makePoint("2026-03-05T12:10:00.000Z", {
      magneticField: { x: 2.1, y: -1.5, z: -6.8, bt: 7.4 },
      solarWind: { speed: 470, density: 7.2, dynamicPressure: 3.5 },
      indices: { kp: 5.5, dst: -68 },
      coupling: { newell: 16200, epsilon: 910000 },
      alerts: { stormTier: "warning", reason: "geomagnetic rise" },
      quality: {
        outlier: false,
        stale: true,
        interpolated: false,
        extrapolated: false,
        lowConfidence: false,
      },
    }),
    makePoint("2026-03-05T12:20:00.000Z", {
      magneticField: { x: 2.0, y: -1.8, z: -8.2, bt: 8.5 },
      solarWind: { speed: 495, density: 8.1, dynamicPressure: 4.2 },
      indices: { kp: 6.5, dst: -91 },
      coupling: { newell: 19400, epsilon: 1020000 },
      alerts: { stormTier: "severe", reason: "storm peak" },
      quality: {
        outlier: false,
        stale: false,
        interpolated: false,
        extrapolated: false,
        lowConfidence: true,
      },
    }),
  ];
  const sourceStatus: SourceStatus[] = [
    {
      source: "noaa-swpc",
      healthy: true,
      lastSeen: "2026-03-05T12:20:00.000Z",
      latencySeconds: 12,
      powerDecision: "primary",
      utilityScore: 0.97,
      targetCadenceMs: 60_000,
      observedCostScore: 0.08,
      avgFetchDurationMs: 210,
      avgCpuMs: 9,
      avgPayloadKb: 14,
      sampleCount: 6,
    },
    {
      source: "mms-lasp",
      healthy: false,
      lastSeen: "2026-03-05T12:12:00.000Z",
      latencySeconds: 520,
      message: "telemetry delayed",
      powerDecision: "sample",
      utilityScore: 0.41,
      targetCadenceMs: 240_000,
      observedCostScore: 0.64,
      avgFetchDurationMs: 1940,
      avgCpuMs: 32,
      avgPayloadKb: 146,
      sampleCount: 3,
    },
  ];

  const summary = buildPlannerTrendSummary({
    sequence,
    sourceStatus,
    threatContext: {
      gateAction: "TRIGGER_LLM",
      topThreatType: "geomagnetic_storm",
      topThreatScore: 0.93,
      topRecommendedAction: "Protect payloads",
      actionableThreatCount: 2,
    },
  });

  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.windowMinutes, 20);
  assert.equal(summary.stormTier, "severe");
  assert.deepEqual(summary.stormTiersSeen, ["quiet", "warning", "severe"]);
  assert.equal(summary.solarWind.latestSpeed, 495);
  assert.equal(summary.solarWind.deltaSpeed, 65);
  assert.equal(summary.solarWind.direction, "rising");
  assert.equal(summary.imf.latestBz, -8.2);
  assert.equal(summary.imf.minBz, -8.2);
  assert.equal(summary.imf.direction, "falling");
  assert.equal(summary.geomagnetic.maxKp, 6.5);
  assert.equal(summary.geomagnetic.direction, "rising");
  assert.equal(summary.coupling.maxNewell, 19400);
  assert.equal(summary.quality.staleSamples, 1);
  assert.equal(summary.quality.lowConfidenceSamples, 1);
  assert.equal(summary.sourceHealth.degradedCount, 1);
  assert.deepEqual(summary.sourceHealth.degradedSources, ["mms-lasp"]);
  assert.equal(summary.sourcePolicy[0]?.source, "noaa-swpc");
  assert.equal(summary.sourcePolicy[0]?.decision, "primary");
  assert.equal(summary.sourcePolicy[0]?.targetCadenceMs, 60_000);
  assert.equal(summary.sourcePolicy[0]?.observedCostScore, 0.08);
  assert.equal(summary.sourcePolicy[1]?.source, "mms-lasp");
  assert.equal(summary.sourcePolicy[1]?.decision, "sample");
  assert.equal(summary.sourcePolicy[1]?.avgFetchDurationMs, 1940);
  assert.equal(summary.threatContext.gateAction, "TRIGGER_LLM");
  assert.equal(summary.threatContext.actionableThreatCount, 2);
  assert.match(summary.threatContext.topRecommendedAction ?? "", /Protect payloads/);
  assert(summary.operationalFlags.includes("storm-tier:severe"));
  assert(summary.operationalFlags.includes("kp-elevated"));
  assert(summary.operationalFlags.includes("southward-imf-strong"));
  assert(summary.operationalFlags.includes("coupling-elevated"));
  assert(summary.operationalFlags.includes("stale-samples-present"));
  assert(summary.operationalFlags.includes("low-confidence-samples"));
  assert(summary.operationalFlags.includes("source-degradation"));
  assert(summary.operationalFlags.includes("threat-gate-escalated"));
  assert(summary.operationalFlags.includes("actionable-threats-present"));
});

test("buildPlannerTrendSummary remains safe for empty history", () => {
  const summary = buildPlannerTrendSummary({
    sequence: [],
    sourceStatus: [],
  });

  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.windowMinutes, 0);
  assert.equal(summary.stormTier, "unknown");
  assert.deepEqual(summary.stormTiersSeen, []);
  assert.equal(summary.solarWind.latestSpeed, null);
  assert.equal(summary.imf.meanBz, null);
  assert.equal(summary.geomagnetic.maxKp, null);
  assert.equal(summary.coupling.maxNewell, null);
  assert.deepEqual(summary.sourcePolicy, []);
  assert.deepEqual(summary.operationalFlags, []);
  assert.equal(summary.threatContext.gateAction, "unknown");
});
