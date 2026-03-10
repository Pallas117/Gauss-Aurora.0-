import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_CONJUNCTION_PURPOSES,
  buildConjunctionRecord,
  evaluateConjunctionPurpose,
} from "./conjunction-interop.js";

test("buildConjunctionRecord parses CDM KVN payload", () => {
  const kvn = [
    "CCSDS_CDM_VERS = 1.0",
    "MESSAGE_ID = MSG-001",
    "TCA = 2026-03-04T02:00:00Z",
    "MISS_DISTANCE = 123.45",
    "RELATIVE_SPEED = 7650.1",
    "COLLISION_PROBABILITY = 0.00042",
    "OBJECT1_NAME = GAUSS-ALPHA",
    "OBJECT1_ID = 48001",
    "OBJECT2_NAME = DEBRIS-2142",
    "OBJECT2_ID = 99001",
  ].join("\n");

  const record = buildConjunctionRecord({
    format: "cdm_kvn",
    content: kvn,
    purpose: "collision_avoidance",
    source: "test-vector",
  });

  assert.equal(record.format, "cdm_kvn");
  assert.equal(record.purpose, "collision_avoidance");
  assert.equal(record.source, "test-vector");
  assert.equal(record.missDistanceM, 123.45);
  assert.equal(record.relativeSpeedMS, 7650.1);
  assert.equal(record.probabilityOfCollision, 0.00042);
  assert.equal(record.primary.name, "GAUSS-ALPHA");
  assert.equal(record.secondary.objectId, "99001");
  assert.equal(Number.isFinite(Date.parse(record.tca ?? "")), true);
});

test("buildConjunctionRecord parses JSON OMM/OEM/OCM style payload", () => {
  const record = buildConjunctionRecord({
    format: "oem_json",
    content: {
      tca: "2026-03-04T03:10:00Z",
      missDistance: 89.2,
      relativeSpeed: 7012.3,
      collisionProbability: 0.0031,
      object1: { name: "SAT-PRIMARY", id: "SAT-1" },
      object2: { name: "SAT-SECONDARY", id: "SAT-2" },
    },
    purpose: "debris_mitigation",
  });

  assert.equal(record.format, "oem_json");
  assert.equal(record.purpose, "debris_mitigation");
  assert.equal(record.missDistanceM, 89.2);
  assert.equal(record.relativeSpeedMS, 7012.3);
  assert.equal(record.primary.objectId, "SAT-1");
  assert.equal(record.secondary.name, "SAT-SECONDARY");
});

test("evaluateConjunctionPurpose blocks offensive usage", () => {
  const decision = evaluateConjunctionPurpose("offensive targeting", "simulate weapon strike");
  assert.equal(decision.allowed, false);
  assert.ok(decision.code === "blocked_keyword" || decision.code === "unknown_purpose");
});

test("allowed purposes list remains explicit and safety-scoped", () => {
  assert.deepEqual(ALLOWED_CONJUNCTION_PURPOSES, [
    "collision_avoidance",
    "debris_mitigation",
    "operator_safety",
    "safety_research",
    "education",
  ]);
});
