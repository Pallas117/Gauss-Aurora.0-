import assert from "node:assert/strict";
import test from "node:test";
import { inferNowcast } from "./client.js";
import type { CanonicalSpaceWeatherPoint, NowcastInferenceRequest } from "../types.js";

function point(
  timestamp: string,
  overrides: Partial<CanonicalSpaceWeatherPoint> = {},
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 5,
    velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
    magneticField: { x: 1.5, y: 0.4, z: 1.2, bt: 2.0 },
    electricField: { x: 0.02, y: 0.12, z: 0.01, ey: 0.12 },
    solarWind: { speed: 390, density: 4.8, dynamicPressure: 1.9 },
    indices: { kp: 1, dst: 5 },
    coupling: { newell: 180, epsilon: 3.5e9 },
    propagation: {
      l1DelaySeconds: 3846,
      etaEarthArrival: new Date(Date.parse(timestamp) + 3_846_000).toISOString(),
    },
    alerts: { stormTier: "quiet", reason: "test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 350, upper: 430, sigma: 20 },
      density: { lower: 4.2, upper: 5.4, sigma: 0.3 },
      bz: { lower: 0.8, upper: 1.6, sigma: 0.2 },
    },
    ...overrides,
  };
}

function req(sequence: CanonicalSpaceWeatherPoint[]): NowcastInferenceRequest {
  return {
    horizonMinutes: 30,
    sequence,
  };
}

test("inferNowcast skips remote inference when gate marks sequence non-urgent", async () => {
  const originalFetch = globalThis.fetch;
  const originalInferUrl = process.env.LOCAL_INFER_URL;
  const originalGate = process.env.GAUSS_PREINFERENCE_GATE_ENABLED;
  const originalNominalMin = process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB;
  const originalCriticalMax = process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB;
  let fetchCalls = 0;

  try {
    process.env.LOCAL_INFER_URL = "http://127.0.0.1:65534";
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = "true";
    process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = "0";
    process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = "0";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called for calm sequence");
    }) as typeof fetch;

    const response = await inferNowcast(req([point("2026-02-22T05:10:00.000Z")]));
    assert.equal(response.modelVersion, "gauss-gate-deterministic-v1");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.LOCAL_INFER_URL = originalInferUrl;
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = originalGate;
    process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = originalNominalMin;
    process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = originalCriticalMax;
  }
});

test("inferNowcast attempts remote inference when gate marks sequence urgent", async () => {
  const originalFetch = globalThis.fetch;
  const originalInferUrl = process.env.LOCAL_INFER_URL;
  const originalGate = process.env.GAUSS_PREINFERENCE_GATE_ENABLED;
  const originalNominalMin = process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB;
  const originalCriticalMax = process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB;
  let fetchCalls = 0;

  try {
    process.env.LOCAL_INFER_URL = "http://127.0.0.1:65534";
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = "true";
    process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = "0";
    process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = "0";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("simulated inference endpoint down");
    }) as typeof fetch;

    const urgent = point("2026-02-22T05:15:00.000Z", {
      magneticField: { x: 3, y: -5, z: -14, bt: 15.2 },
      electricField: { x: 0.2, y: 6.1, z: 0.4, ey: 6.1 },
      indices: { kp: 7, dst: -120 },
      coupling: { newell: 11000, epsilon: 6.0e11 },
      alerts: { stormTier: "severe", reason: "storm" },
    });

    const response = await inferNowcast(req([urgent]));
    assert.equal(fetchCalls, 1);
    assert.equal(response.modelVersion, "unet-baseline-v1");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.LOCAL_INFER_URL = originalInferUrl;
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = originalGate;
    process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = originalNominalMin;
    process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = originalCriticalMax;
  }
});
