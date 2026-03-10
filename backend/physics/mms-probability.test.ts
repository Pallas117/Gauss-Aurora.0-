import assert from "node:assert/strict";
import test from "node:test";
import { fuseMmsVector } from "./mms-probability.js";
import type { CanonicalSpaceWeatherPoint, MMSReconVectorPoint } from "../types.js";

function canonicalPoint(
  timestamp: string,
  overrides: Partial<CanonicalSpaceWeatherPoint> = {},
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 5,
    velocity: { x: -420, y: 2, z: -6, magnitude: 420.05 },
    magneticField: { x: 2, y: -3, z: -8, bt: 8.77 },
    electricField: { x: 0.2, y: 3.1, z: 0.1, ey: 3.1 },
    solarWind: { speed: 420.05, density: 5, dynamicPressure: 2.8 },
    indices: { kp: 4, dst: -45 },
    coupling: { newell: 6800, epsilon: 2.4e11 },
    propagation: {
      l1DelaySeconds: 3571,
      etaEarthArrival: new Date(Date.parse(timestamp) + 3571 * 1000).toISOString(),
    },
    alerts: { stormTier: "warning", reason: "test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 390, upper: 450, sigma: 15 },
      density: { lower: 4.2, upper: 5.8, sigma: 0.4 },
      bz: { lower: -10, upper: -6, sigma: 1 },
    },
    ...overrides,
  };
}

function mmsVector(
  timestamp: string,
  overrides: Partial<MMSReconVectorPoint> = {},
): MMSReconVectorPoint {
  return {
    timestamp,
    barycenterGsmRe: { x: 9.8, y: -1.2, z: 0.4 },
    currentDensity: { x: -0.35, y: -0.8, z: 0.05, magnitude: 0.874 },
    normal: { x: 0, y: -1, z: 0 },
    lmn: {
      l: { x: 1, y: 0, z: 0 },
      m: { x: 0, y: 0, z: 1 },
      n: { x: 0, y: -1, z: 0 },
    },
    quality: {
      valid: true,
      volume: 0.12,
      conditionNumber: 12,
      divCurlRatio: 0.2,
      confidence: "high",
    },
    ...overrides,
  };
}

test("directionality correction flips measured normal to align with live electric driver", () => {
  const ts = "2026-02-22T04:00:00.000Z";
  const measured = mmsVector(ts, {
    normal: { x: 0, y: -1, z: 0 },
  });
  const canonical = canonicalPoint(ts, {
    electricField: { x: 0, y: 4, z: 0, ey: 4 },
  });

  const fused = fuseMmsVector({
    measuredVector: measured,
    previousVector: null,
    canonicalPoint: canonical,
    previousCanonicalPoint: null,
    sampleCount: 4,
    burstMode: false,
    nowIso: ts,
  });

  assert.ok(fused, "expected a fused MMS vector");
  assert.equal(fused!.directionality?.corrected, true);
  assert.ok(fused!.normal.y > 0, "normal should be flipped to +Y");
  assert.ok((fused!.probability?.reconnection ?? 0) > 0);
});

test("predicts MMS vector when live tetrahedron is unavailable", () => {
  const previousTs = "2026-02-22T04:00:00.000Z";
  const nowTs = "2026-02-22T04:00:35.000Z";
  const previous = mmsVector(previousTs);
  const canonical = canonicalPoint(nowTs);

  const fused = fuseMmsVector({
    measuredVector: null,
    previousVector: previous,
    canonicalPoint: canonical,
    previousCanonicalPoint: canonicalPoint(previousTs),
    sampleCount: 0,
    burstMode: false,
    nowIso: nowTs,
  });

  assert.ok(fused, "expected prediction fallback");
  assert.equal(fused!.provenance?.mode, "predicted");
  assert.equal(fused!.quality.valid, false);
  assert.equal(fused!.timestamp, nowTs);
  assert.ok((fused!.probability?.confidence ?? 0) > 0);
});

test("burst mode raises reconnection probability for equivalent inputs", () => {
  const ts = "2026-02-22T04:05:00.000Z";
  const previous = mmsVector("2026-02-22T04:04:55.000Z");
  const measured = mmsVector(ts, {
    normal: { x: 0, y: 1, z: 0 },
  });
  const canonical = canonicalPoint(ts, {
    magneticField: { x: 1, y: -2, z: -10, bt: 10.25 },
    electricField: { x: 0.1, y: 4.2, z: 0, ey: 4.2 },
  });

  const base = fuseMmsVector({
    measuredVector: measured,
    previousVector: previous,
    canonicalPoint: canonical,
    previousCanonicalPoint: canonicalPoint(previous.timestamp),
    sampleCount: 4,
    burstMode: false,
    nowIso: ts,
  });
  const burst = fuseMmsVector({
    measuredVector: measured,
    previousVector: previous,
    canonicalPoint: canonical,
    previousCanonicalPoint: canonicalPoint(previous.timestamp),
    sampleCount: 4,
    burstMode: true,
    nowIso: ts,
  });

  assert.ok(base && burst, "expected both solutions");
  assert.ok((burst!.probability?.reconnection ?? 0) >= (base!.probability?.reconnection ?? 0));
});
