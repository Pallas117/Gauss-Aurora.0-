import assert from "node:assert/strict";
import test from "node:test";
import type { ConjunctionRecord } from "./conjunction-interop.js";
import {
  appendConjunctionRecord,
  getSpaceDomainSnapshot,
  resetSpaceDomainStore,
  setRiskZoneSnapshot,
  setSatelliteObjectsSnapshot,
} from "./space-domain-store.js";

function conjunctionRecord(index: number): ConjunctionRecord {
  return {
    id: `cdm-${index}`,
    ingestedAt: new Date(Date.parse("2026-03-10T00:00:00.000Z") + index * 1000).toISOString(),
    format: "cdm_json",
    purpose: "collision_avoidance",
    source: "test-suite",
    tca: new Date(Date.parse("2026-03-10T01:00:00.000Z") + index * 1000).toISOString(),
    missDistanceM: Math.max(50, 1_000 - index),
    relativeSpeedMS: 7_300,
    probabilityOfCollision: 0.001 + index * 1e-5,
    primary: { name: "GAUSS-A", objectId: "A-1" },
    secondary: { name: "DEBRIS", objectId: `D-${index}` },
    warnings: [],
    rawExcerpt: "{}",
  };
}

test("space domain store consolidates bounded SSA snapshots", () => {
  resetSpaceDomainStore();

  setRiskZoneSnapshot(
    Array.from({ length: 60 }, (_unused, index) => ({
      orbitType: index % 2 === 0 ? "GEO" : "MEO",
      altitudeKm: index % 2 === 0 ? 35_786 : 20_200,
      latitudeDeg: 0,
      longitudeDeg: index,
      riskScore: Math.min(1, index / 50),
      objectCount: index + 1,
    })),
  );

  setSatelliteObjectsSnapshot(
    Array.from({ length: 230 }, (_unused, index) => ({
      noradId: `${10_000 + index}`,
      name: `SAT-${index}`,
      orbitType: index % 3 === 0 ? "GEO" : index % 3 === 1 ? "MEO" : "LEO",
      altitudeKm: index % 3 === 0 ? 35_786 : index % 3 === 1 ? 20_200 : 550,
      latitudeDeg: 0,
      longitudeDeg: index,
      highValue: index < 3,
      unidentified: index % 7 === 0,
    })),
  );

  for (let index = 0; index < 205; index += 1) {
    appendConjunctionRecord(conjunctionRecord(index));
  }

  const snapshot = getSpaceDomainSnapshot({ conjunctionLimit: 10 });

  assert.equal(snapshot.riskZones?.riskZones.length, 50);
  assert.equal(snapshot.satellites?.objects.length, 200);
  assert.equal(snapshot.satellites?.highValue.length, 3);
  assert.equal(snapshot.conjunctions.events.length, 10);
  assert.equal(snapshot.conjunctions.events[0]?.id, "cdm-204");
  assert.equal(snapshot.conjunctions.events[9]?.id, "cdm-195");
  assert.ok(snapshot.updatedAt);

  resetSpaceDomainStore();
});
