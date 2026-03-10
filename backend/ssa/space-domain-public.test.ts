import assert from "node:assert/strict";
import test from "node:test";
import { toPublicSpaceDomainSnapshot } from "./space-domain-public.js";

test("public space domain snapshot exposes conjunction counts without raw events", () => {
  const publicSnapshot = toPublicSpaceDomainSnapshot({
    updatedAt: "2026-03-10T12:05:00.000Z",
    riskZones: {
      updatedAt: "2026-03-10T12:00:00.000Z",
      riskZones: [
        {
          orbitType: "GEO",
          altitudeKm: 35_786,
          latitudeDeg: 0,
          longitudeDeg: 15,
          riskScore: 0.7,
          objectCount: 20,
        },
      ],
    },
    satellites: null,
    conjunctions: {
      updatedAt: "2026-03-10T12:04:00.000Z",
      events: [
        {
          id: "cdm-1",
          ingestedAt: "2026-03-10T12:04:00.000Z",
          format: "cdm_json",
          purpose: "collision_avoidance",
          source: "test",
          tca: "2026-03-10T13:00:00.000Z",
          missDistanceM: 200,
          relativeSpeedMS: 7_600,
          probabilityOfCollision: 0.02,
          primary: { name: "A", objectId: "1" },
          secondary: { name: "B", objectId: "2" },
          warnings: [],
          rawExcerpt: "{}",
        },
      ],
    },
  });

  assert.equal(publicSnapshot.conjunctions.count, 1);
  assert.equal(publicSnapshot.conjunctions.updatedAt, "2026-03-10T12:04:00.000Z");
  assert.ok(!("events" in publicSnapshot.conjunctions));
  assert.equal(publicSnapshot.riskZones?.riskZones.length, 1);
});
