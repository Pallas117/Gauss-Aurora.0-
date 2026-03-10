import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInferenceUrgency } from "./probability-gate.js";
import type { CanonicalSpaceWeatherPoint, NowcastInferenceRequest } from "../types.js";

function point(
  timestamp: string,
  overrides: Partial<CanonicalSpaceWeatherPoint> = {},
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 5,
    velocity: { x: -410, y: 2, z: -1, magnitude: 410.01 },
    magneticField: { x: 3, y: -2, z: -6, bt: 7.0 },
    electricField: { x: 0.1, y: 2.2, z: 0.1, ey: 2.2 },
    solarWind: { speed: 410, density: 5, dynamicPressure: 2.2 },
    indices: { kp: 3, dst: -30 },
    coupling: { newell: 2200, epsilon: 1.6e11 },
    propagation: {
      l1DelaySeconds: 3658,
      etaEarthArrival: new Date(Date.parse(timestamp) + 3_658_000).toISOString(),
    },
    alerts: { stormTier: "watch", reason: "test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 380, upper: 440, sigma: 15 },
      density: { lower: 4.4, upper: 5.6, sigma: 0.3 },
      bz: { lower: -7, upper: -5, sigma: 0.5 },
    },
    ...overrides,
  };
}

test("threat summary payload is endpoint-ready", () => {
  const now = "2026-02-22T06:15:00.000Z";
  const request: NowcastInferenceRequest = {
    horizonMinutes: 30,
    sequence: [point(now)],
  };

  const decision = evaluateInferenceUrgency(request);
  assert.ok(Array.isArray(decision.threat_summary));
  assert.ok(decision.threat_count >= 1);
  assert.ok(decision.top_threat_score >= 0);
  assert.equal(
    decision.actionable_threat_count,
    decision.threat_summary.filter((item) => item.actionable).length,
  );
});
