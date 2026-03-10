import assert from "node:assert/strict";
import test from "node:test";
import { vec } from "./coordinates.js";
import { confidenceLabel, confidenceScore, mix, mixVec } from "./mms-probability-helpers.js";

test("mix interpolates between a and b", () => {
  assert.strictEqual(mix(0, 10, 0), 0);
  assert.strictEqual(mix(0, 10, 1), 10);
  assert.strictEqual(mix(0, 10, 0.5), 5);
});

test("mixVec interpolates vectors", () => {
  const a = vec(0, 0, 0);
  const b = vec(2, 4, 6);
  const mid = mixVec(a, b, 0.5);
  assert.strictEqual(mid.x, 1);
  assert.strictEqual(mid.y, 2);
  assert.strictEqual(mid.z, 3);
});

test("confidenceScore maps high/medium/low to numbers", () => {
  assert.strictEqual(confidenceScore("high"), 1);
  assert.strictEqual(confidenceScore("medium"), 0.65);
  assert.strictEqual(confidenceScore("low"), 0.35);
});

test("confidenceLabel maps score to high/medium/low", () => {
  assert.strictEqual(confidenceLabel(0.9), "high");
  assert.strictEqual(confidenceLabel(0.5), "medium");
  assert.strictEqual(confidenceLabel(0.2), "low");
});
