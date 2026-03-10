import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessSsaLearnedLane,
  buildSsaLearnedLaneFeatures,
  type SsaDeterministicSummaryInput,
} from "./ssa-learned-lane.js";
import type { SpaceDomainSnapshot } from "../ssa/space-domain-store.js";

function snapshot(now = Date.now()): SpaceDomainSnapshot {
  return {
    updatedAt: new Date(now).toISOString(),
    riskZones: {
      updatedAt: new Date(now - 45_000).toISOString(),
      riskZones: [
        {
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0,
          longitudeDeg: 22,
          riskScore: 0.94,
          objectCount: 82,
        },
      ],
    },
    satellites: {
      updatedAt: new Date(now - 20_000).toISOString(),
      objects: [
        {
          noradId: "25544",
          name: "GAUSS-HV",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0,
          longitudeDeg: 22,
          highValue: true,
          unidentified: false,
        },
        {
          noradId: "40001",
          name: "CAT-1",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0.6,
          longitudeDeg: 29,
          highValue: false,
          unidentified: true,
        },
        {
          noradId: "40002",
          name: "CAT-2",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: -1.2,
          longitudeDeg: 31,
          highValue: false,
          unidentified: true,
        },
        {
          noradId: "40003",
          name: "CAT-3",
          orbitType: "MEO",
          altitudeKm: 20_200,
          latitudeDeg: 4.1,
          longitudeDeg: 61,
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
          longitudeDeg: 22,
          highValue: true,
          unidentified: false,
        },
      ],
      unidentified: [
        {
          noradId: "40001",
          name: "CAT-1",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0.6,
          longitudeDeg: 29,
          highValue: false,
          unidentified: true,
        },
        {
          noradId: "40002",
          name: "CAT-2",
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: -1.2,
          longitudeDeg: 31,
          highValue: false,
          unidentified: true,
        },
      ],
    },
    conjunctions: {
      updatedAt: new Date(now - 10_000).toISOString(),
      events: [
        {
          id: "cdm-1",
          ingestedAt: new Date(now - 60_000).toISOString(),
          format: "cdm_json",
          purpose: "collision_avoidance",
          source: "test",
          tca: new Date(now + 3_600_000).toISOString(),
          missDistanceM: 900,
          relativeSpeedMS: 7_500,
          probabilityOfCollision: 0.014,
          primary: { name: "GAUSS-HV", objectId: "25544" },
          secondary: { name: "CAT-1", objectId: "40001" },
          warnings: [],
          rawExcerpt: "{}",
        },
      ],
    },
  };
}

function summaryInput(): SsaDeterministicSummaryInput {
  return {
    freshness: {
      riskZonesAgeSeconds: 45,
      satellitesAgeSeconds: 20,
      conjunctionsAgeSeconds: 10,
    },
    availability: {
      riskZones: true,
      satellites: true,
      conjunctions: true,
    },
    counts: {
      riskZoneCount: 1,
      satelliteObjectCount: 4,
      highValueCount: 1,
      unidentifiedCount: 2,
      conjunctionCount: 1,
    },
    crowding: {
      maxRiskScore: 0.94,
      avgRiskScore: 0.94,
      geoMaxRiskScore: 0.94,
      meoMaxRiskScore: 0,
      weightedObjectDensity: 77.08,
      unidentifiedRatio: 0.5,
    },
    conjunctionRisk: {
      maxCollisionProbability: 0.014,
      minMissDistanceM: 900,
      recentCriticalCount: 1,
    },
  };
}

test("SSA learned lane derives normalized features and triggers on high-risk conjunction context", () => {
  const features = buildSsaLearnedLaneFeatures(snapshot(), summaryInput());
  assert.ok(features.highValueNeighborDensity > 0);
  assert.ok(features.debrisDensity > 0.5);
  assert.ok(features.tleFreshnessScore > 0.9);

  const assessment = assessSsaLearnedLane(snapshot(), summaryInput());
  assert.equal(assessment.modelVersion, "ssa-lane-logreg-v1");
  assert.equal(assessment.trigger, true);
  assert.ok(assessment.score >= assessment.threshold);
  assert.ok(assessment.topContributors.length > 0);
});

test("SSA learned lane loads a registry override when configured", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-ssa-lane-"));
  const registryPath = path.join(tmpDir, "ssa-registry.json");
  const originalRegistryPath = process.env.SSA_MODEL_REGISTRY_PATH;

  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        models: [
          {
            version: "ssa-lane-custom-v2",
            kind: "ssa-lane",
            trained_at: "2026-03-10T12:00:00Z",
            status: "ready",
            metrics: {
              samples: 1_024,
              intercept: -0.95,
              threshold: 0.6,
              weights: {
                conjunctionCount: 0.25,
                maxCollisionProbability: 1.25,
                inverseMissDistance: 0.9,
                debrisDensity: 0.5,
                highValueNeighborDensity: 0.7,
                unidentifiedRatio: 0.4,
                geoCrowdingScore: 0.32,
                meoCrowdingScore: 0.18,
                leoCrowdingScore: 0.1,
                tleFreshnessScore: 0.15,
                conjunctionFreshnessScore: 0.34,
                availabilityScore: 0.3,
              },
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    process.env.SSA_MODEL_REGISTRY_PATH = registryPath;
    const assessment = assessSsaLearnedLane(snapshot(), summaryInput());
    assert.equal(assessment.modelVersion, "ssa-lane-custom-v2");
    assert.equal(assessment.threshold, 0.6);
    assert.ok(assessment.blend > 0.4);
  } finally {
    process.env.SSA_MODEL_REGISTRY_PATH = originalRegistryPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
