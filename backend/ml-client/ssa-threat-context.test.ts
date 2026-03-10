import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalSpaceWeatherPoint } from "../types.js";
import { buildSsaThreatContext } from "./ssa-threat-context.js";

function point(timestamp: string): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 5,
    velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
    magneticField: { x: 2, y: -1, z: -5, bt: 5.5 },
    electricField: { x: 0.1, y: 1.8, z: 0.1, ey: 1.8 },
    solarWind: { speed: 420, density: 6, dynamicPressure: 2.3 },
    indices: { kp: 3, dst: -25 },
    coupling: { newell: 2_300, epsilon: 1.8e11 },
    propagation: {
      l1DelaySeconds: 3_700,
      etaEarthArrival: new Date(Date.parse(timestamp) + 3_700_000).toISOString(),
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
      speed: { lower: 390, upper: 450, sigma: 12 },
      density: { lower: 5, upper: 7, sigma: 0.5 },
      bz: { lower: -6, upper: -4, sigma: 0.4 },
    },
  };
}

test("SSA threat context prioritizes high-value assets and propagates conjunction evidence", () => {
  const context = buildSsaThreatContext([point("2026-03-10T00:00:00.000Z")], {
    spaceDomainSnapshot: {
      updatedAt: "2026-03-10T00:00:05.000Z",
      riskZones: {
        updatedAt: "2026-03-10T00:00:04.000Z",
        riskZones: [
          { orbitType: "GEO", altitudeKm: 35_786, latitudeDeg: 0, longitudeDeg: 20, riskScore: 0.7, objectCount: 24 },
        ],
      },
      satellites: {
        updatedAt: "2026-03-10T00:00:03.000Z",
        objects: [
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
            longitudeDeg: 20.4,
            highValue: false,
            unidentified: false,
          },
        ],
        highValue: [
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
        ],
        unidentified: [],
      },
      conjunctions: {
        updatedAt: "2026-03-10T00:00:02.000Z",
        events: [
          {
            id: "cdm-1",
            ingestedAt: new Date(Date.now() - 60_000).toISOString(),
            format: "cdm_json",
            purpose: "collision_avoidance",
            source: "test",
            tca: "2026-03-10T01:00:00.000Z",
            missDistanceM: 500,
            relativeSpeedMS: 7_600,
            probabilityOfCollision: 0.015,
            primary: { name: "GAUSS-HV", objectId: "25544" },
            secondary: { name: "CAT-1", objectId: "40001" },
            warnings: [],
            rawExcerpt: "{}",
          },
        ],
      },
    },
  });

  assert.equal(context.referenceAsset.source, "high-value");
  assert.equal(context.referenceAsset.noradId, "25544");
  assert.equal(context.externalData.space_track?.objects?.length, 1);
  assert.equal(context.externalData.space_track?.max_probability_of_collision, 0.015);
  assert.equal(context.externalData.space_track?.min_miss_distance_m, 500);
  assert.ok((context.externalData.debris?.density ?? 0) >= 0.01);
  assert.equal(context.spaceDomainSummary.counts.highValueCount, 1);
  assert.equal(context.learnedLane.modelVersion, "ssa-lane-logreg-v1");
  assert.equal(context.learnedLane.trigger, true);
  assert.ok((context.externalData.space_track?.historical_conjunction_rate ?? 0) >= 0.12);
});

test("SSA threat context falls back to risk zones when catalog objects are unavailable", () => {
  const context = buildSsaThreatContext([point("2026-03-10T00:05:00.000Z")], {
    riskZones: [
      { orbitType: "MEO", altitudeKm: 20_200, latitudeDeg: 2, longitudeDeg: 40, riskScore: 0.5, objectCount: 12 },
    ],
  });

  assert.equal(context.referenceAsset.source, "risk-zone");
  assert.equal(context.referenceAsset.orbitType, "MEO");
  assert.equal(context.externalData.debris?.objects?.length, 1);
});
