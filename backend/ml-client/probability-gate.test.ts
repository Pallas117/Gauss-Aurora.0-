import assert from "node:assert/strict";
import test from "node:test";
import { GaussProbabilityEngine, evaluateInferenceUrgency } from "./probability-gate.js";
import type { CanonicalSpaceWeatherPoint, NowcastInferenceRequest } from "../types.js";
import {
  appendConjunctionRecord,
  resetSpaceDomainStore,
  setRiskZoneSnapshot,
  setSatelliteObjectsSnapshot,
} from "../ssa/space-domain-store.js";

function point(
  timestamp: string,
  overrides: Partial<CanonicalSpaceWeatherPoint> = {},
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 5,
    velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
    magneticField: { x: 2, y: -1, z: -4, bt: 4.58 },
    electricField: { x: 0.1, y: 1.5, z: 0.2, ey: 1.5 },
    solarWind: { speed: 400, density: 5, dynamicPressure: 2.1 },
    indices: { kp: 2, dst: -20 },
    coupling: { newell: 1500, epsilon: 1.2e11 },
    propagation: {
      l1DelaySeconds: 3750,
      etaEarthArrival: new Date(Date.parse(timestamp) + 3_750_000).toISOString(),
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
      speed: { lower: 360, upper: 440, sigma: 20 },
      density: { lower: 4, upper: 6, sigma: 0.5 },
      bz: { lower: -5, upper: -3, sigma: 0.5 },
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

test("GaussProbabilityEngine marks high flux as urgent", () => {
  const engine = new GaussProbabilityEngine();
  const decision = engine.evaluateTelemetryUrgency(2.0e-4);
  assert.equal(decision.is_urgent, true);
  assert.equal(decision.action, "TRIGGER_LLM");
});

test("GaussProbabilityEngine marks nominal flux as non-urgent", () => {
  const engine = new GaussProbabilityEngine();
  const decision = engine.evaluateTelemetryUrgency(6.0e-5);
  assert.equal(decision.is_urgent, false);
  assert.equal(decision.action, "LOG_AND_SLEEP");
});

test("inference urgency returns non-urgent for calm telemetry", () => {
  const ts = "2026-02-22T05:00:00.000Z";
  const calm = point(ts, {
    magneticField: { x: 1.5, y: 0.4, z: 1.2, bt: 2.0 },
    electricField: { x: 0.02, y: 0.12, z: 0.01, ey: 0.12 },
    indices: { kp: 1, dst: 5 },
    coupling: { newell: 180, epsilon: 3.5e9 },
    alerts: { stormTier: "quiet", reason: "calm" },
  });
  const decision = evaluateInferenceUrgency(req([calm]));

  assert.equal(decision.is_urgent, false);
  assert.equal(decision.action, "LOG_AND_SLEEP");
  assert.ok(decision.flux_proxy < 1.5e-4);
  assert.ok(Array.isArray(decision.threat_summary));
  assert.ok(decision.threat_count >= 1);
});

test("inference urgency forces trigger on severe storm tier", () => {
  const ts = "2026-02-22T05:05:00.000Z";
  const severe = point(ts, {
    magneticField: { x: 3, y: -5, z: -14, bt: 15.2 },
    electricField: { x: 0.2, y: 6.1, z: 0.4, ey: 6.1 },
    indices: { kp: 7, dst: -120 },
    coupling: { newell: 11000, epsilon: 6.0e11 },
    alerts: { stormTier: "severe", reason: "storm" },
  });
  const decision = evaluateInferenceUrgency(req([severe]));

  assert.equal(decision.is_urgent, true);
  assert.equal(decision.action, "TRIGGER_LLM");
  assert.match(decision.reason, /Storm tier severe/i);
  assert.ok(decision.top_threat_score >= 0);
});

test("inference urgency tolerates malformed sequence members", () => {
  const decision = evaluateInferenceUrgency({
    horizonMinutes: 30,
    sequence: [null as unknown as CanonicalSpaceWeatherPoint],
  });

  assert.equal(decision.is_urgent, true);
  assert.equal(decision.action, "TRIGGER_LLM");
  assert.match(decision.reason, /No telemetry sequence provided/i);
});

// PROJECT GAUSS directive: heavy LLM must stay dormant until anomaly exceeds 3-sigma.
// When gate returns LOG_AND_SLEEP, the caller must not invoke the LLM.
test("directive: below-threshold telemetry yields LOG_AND_SLEEP (LLM not triggered)", () => {
  const engine = new GaussProbabilityEngine({
    fluxThreshold: 1.5e-4,
    safetyMargin: 0.15,
    sigma: 5e-5,
  });
  const lowFlux = 5e-5;
  const decision = engine.evaluateTelemetryUrgency(lowFlux);
  assert.equal(decision.action, "LOG_AND_SLEEP");
  assert.equal(decision.is_urgent, false);

  const ts = "2026-02-22T06:00:00.000Z";
  const calm = point(ts, {
    magneticField: { x: 1, y: 0, z: 0.5, bt: 1.2 },
    electricField: { x: 0, y: 0.05, z: 0, ey: 0.05 },
    indices: { kp: 0, dst: 10 },
    coupling: { newell: 50, epsilon: 1e9 },
    alerts: { stormTier: "quiet", reason: "nominal" },
  });
  const fullDecision = evaluateInferenceUrgency(req([calm]));
  assert.equal(fullDecision.action, "LOG_AND_SLEEP");
  assert.equal(fullDecision.is_urgent, false);
});

test("conjunction evidence can trigger inference even under calm heliophysics", () => {
  resetSpaceDomainStore();
  try {
    setSatelliteObjectsSnapshot([
      {
        noradId: "25544",
        name: "GAUSS-HV",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 0,
        longitudeDeg: 20,
        highValue: true,
        unidentified: false,
      },
      {
        noradId: "40001",
        name: "CAT-1",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 0,
        longitudeDeg: 20.02,
        highValue: false,
        unidentified: false,
      },
    ]);
    appendConjunctionRecord({
      id: "cdm-critical",
      ingestedAt: new Date().toISOString(),
      format: "cdm_json",
      purpose: "collision_avoidance",
      source: "test",
      tca: new Date(Date.now() + 3_600_000).toISOString(),
      missDistanceM: 180,
      relativeSpeedMS: 7_650,
      probabilityOfCollision: 0.018,
      primary: { name: "GAUSS-HV", objectId: "25544" },
      secondary: { name: "CAT-1", objectId: "40001" },
      warnings: [],
      rawExcerpt: "{}",
    });

    const calm = point("2026-02-22T07:00:00.000Z", {
      magneticField: { x: 1.2, y: 0.3, z: 0.8, bt: 1.5 },
      electricField: { x: 0.01, y: 0.08, z: 0.01, ey: 0.08 },
      indices: { kp: 1, dst: 3 },
      coupling: { newell: 120, epsilon: 2.0e9 },
      alerts: { stormTier: "quiet", reason: "nominal" },
    });

    const decision = evaluateInferenceUrgency(req([calm]));

    assert.equal(decision.is_urgent, true);
    assert.equal(decision.action, "TRIGGER_LLM");
    assert.match(decision.reason, /Threat fusion triggered/i);
    assert.ok(
      decision.threat_summary.some(
        (threat) => threat.type === "collision" && threat.composite_score >= 0.72,
      ),
    );
  } finally {
    resetSpaceDomainStore();
  }
});

test("learned SSA lane can trigger inference from a crowded high-value shell", () => {
  resetSpaceDomainStore();
  try {
    setRiskZoneSnapshot([
      {
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 0,
        longitudeDeg: 30,
        riskScore: 0.96,
        objectCount: 96,
      },
      {
        orbitType: "MEO",
        altitudeKm: 20_200,
        latitudeDeg: 8,
        longitudeDeg: 64,
        riskScore: 0.58,
        objectCount: 18,
      },
    ]);
    setSatelliteObjectsSnapshot([
      {
        noradId: "25544",
        name: "GAUSS-HV",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 0,
        longitudeDeg: 30,
        highValue: true,
        unidentified: false,
      },
      {
        noradId: "41001",
        name: "CAT-1",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 0.8,
        longitudeDeg: 38,
        highValue: false,
        unidentified: true,
      },
      {
        noradId: "41002",
        name: "CAT-2",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: -1.1,
        longitudeDeg: 39.5,
        highValue: false,
        unidentified: true,
      },
      {
        noradId: "41003",
        name: "CAT-3",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 1.4,
        longitudeDeg: 34.5,
        highValue: false,
        unidentified: false,
      },
      {
        noradId: "41004",
        name: "CAT-4",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: -1.8,
        longitudeDeg: 40.8,
        highValue: false,
        unidentified: true,
      },
      {
        noradId: "41005",
        name: "CAT-5",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: 2.1,
        longitudeDeg: 41.2,
        highValue: false,
        unidentified: false,
      },
      {
        noradId: "41006",
        name: "CAT-6",
        orbitType: "GEO",
        altitudeKm: 35_786,
        latitudeDeg: -2.3,
        longitudeDeg: 35.8,
        highValue: false,
        unidentified: true,
      },
      {
        noradId: "41007",
        name: "CAT-7",
        orbitType: "MEO",
        altitudeKm: 20_200,
        latitudeDeg: 4.3,
        longitudeDeg: 60,
        highValue: false,
        unidentified: false,
      },
    ]);

    const calm = point("2026-02-22T07:30:00.000Z", {
      magneticField: { x: 1.1, y: 0.2, z: 0.6, bt: 1.4 },
      electricField: { x: 0.01, y: 0.06, z: 0.01, ey: 0.06 },
      indices: { kp: 1, dst: 4 },
      coupling: { newell: 90, epsilon: 1.5e9 },
      alerts: { stormTier: "quiet", reason: "nominal" },
    });

    const decision = evaluateInferenceUrgency(req([calm]));

    assert.equal(decision.is_urgent, true);
    assert.equal(decision.action, "TRIGGER_LLM");
    assert.match(decision.reason, /Learned SSA lane triggered/i);
  } finally {
    resetSpaceDomainStore();
  }
});
