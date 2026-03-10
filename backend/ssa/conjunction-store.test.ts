import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistedConjunctionRow,
  mapPersistedConjunctionRow,
} from "./conjunction-store.js";
import type { ConjunctionRecord } from "./conjunction-interop.js";

test("conjunction persistence mapping round-trips canonical record fields", () => {
  const record: ConjunctionRecord = {
    id: "cdm-42",
    ingestedAt: "2026-03-10T12:00:00.000Z",
    format: "cdm_json",
    purpose: "collision_avoidance",
    source: "unit-test",
    tca: "2026-03-10T13:00:00.000Z",
    missDistanceM: 320,
    relativeSpeedMS: 7_550,
    probabilityOfCollision: 0.0125,
    primary: { name: "GAUSS-A", objectId: "25544" },
    secondary: { name: "DEBRIS-X", objectId: "99001" },
    warnings: ["critical-miss-distance"],
    rawExcerpt: "{\"pc\":0.0125}",
  };

  const row = buildPersistedConjunctionRow(record);
  const parsed = mapPersistedConjunctionRow(row);

  assert.deepEqual(parsed, record);
});
