import assert from "node:assert/strict";
import test from "node:test";
import { buildSpaceDomainSummary } from "./ssa-features.js";

test("space domain summary derives crowding, freshness, and conjunction risk", () => {
  const now = Date.now();
  const summary = buildSpaceDomainSummary({
    updatedAt: new Date(now).toISOString(),
    riskZones: {
      updatedAt: new Date(now - 45_000).toISOString(),
      riskZones: [
        { orbitType: "GEO", altitudeKm: 35_786, latitudeDeg: 0, longitudeDeg: 80, riskScore: 0.8, objectCount: 20 },
        { orbitType: "MEO", altitudeKm: 20_200, latitudeDeg: 5, longitudeDeg: -30, riskScore: 0.4, objectCount: 10 },
      ],
    },
    satellites: {
      updatedAt: new Date(now - 15_000).toISOString(),
      objects: [
        {
          noradId: "25544",
          name: "ISS",
          orbitType: "LEO",
          altitudeKm: 420,
          latitudeDeg: 1,
          longitudeDeg: 2,
          highValue: true,
          unidentified: false,
        },
        {
          noradId: "90123",
          name: "UNKNOWN-1",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0,
          longitudeDeg: 75,
          highValue: false,
          unidentified: true,
        },
      ],
      highValue: [
        {
          noradId: "25544",
          name: "ISS",
          orbitType: "LEO",
          altitudeKm: 420,
          latitudeDeg: 1,
          longitudeDeg: 2,
          highValue: true,
          unidentified: false,
        },
      ],
      unidentified: [
        {
          noradId: "90123",
          name: "UNKNOWN-1",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0,
          longitudeDeg: 75,
          highValue: false,
          unidentified: true,
        },
      ],
    },
    conjunctions: {
      updatedAt: new Date(now - 5_000).toISOString(),
      events: [
        {
          id: "recent-critical",
          ingestedAt: new Date(now - 60_000).toISOString(),
          format: "cdm_json",
          purpose: "collision_avoidance",
          source: "test",
          tca: new Date(now + 600_000).toISOString(),
          missDistanceM: 1_200,
          relativeSpeedMS: 7_500,
          probabilityOfCollision: 0.021,
          primary: { name: "A", objectId: "1" },
          secondary: { name: "B", objectId: "2" },
          warnings: [],
          rawExcerpt: "{}",
        },
        {
          id: "old-low-risk",
          ingestedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
          format: "cdm_json",
          purpose: "collision_avoidance",
          source: "test",
          tca: new Date(now + 1_200_000).toISOString(),
          missDistanceM: 25_000,
          relativeSpeedMS: 7_400,
          probabilityOfCollision: 0.0001,
          primary: { name: "C", objectId: "3" },
          secondary: { name: "D", objectId: "4" },
          warnings: [],
          rawExcerpt: "{}",
        },
      ],
    },
  });

  assert.equal(summary.availability.riskZones, true);
  assert.equal(summary.availability.satellites, true);
  assert.equal(summary.counts.riskZoneCount, 2);
  assert.equal(summary.counts.highValueCount, 1);
  assert.equal(summary.counts.unidentifiedCount, 1);
  assert.equal(summary.crowding.maxRiskScore, 0.8);
  assert.equal(summary.crowding.geoMaxRiskScore, 0.8);
  assert.equal(summary.crowding.meoMaxRiskScore, 0.4);
  assert.equal(summary.crowding.unidentifiedRatio, 0.5);
  assert.equal(summary.conjunctionRisk.maxCollisionProbability, 0.021);
  assert.equal(summary.conjunctionRisk.minMissDistanceM, 1_200);
  assert.equal(summary.conjunctionRisk.recentCriticalCount, 1);
  assert.ok(summary.freshness.riskZonesAgeSeconds != null);
  assert.ok(summary.freshness.satellitesAgeSeconds != null);
  assert.equal(summary.learnedLane.modelVersion, "ssa-lane-logreg-v1");
  assert.equal(summary.learnedLane.trigger, true);
  assert.ok(summary.learnedLane.score >= summary.learnedLane.threshold);
  assert.ok(summary.learnedLane.topContributors.length > 0);
});
