import assert from "node:assert/strict";
import test from "node:test";
import {
  clamp01,
  confidenceInterval,
  distance,
  magnitude,
  normalCdf,
  sigmoid,
} from "./probability-fusion-scoring.js";

test("clamp01 clamps to [0,1]", () => {
  assert.strictEqual(clamp01(-0.5), 0);
  assert.strictEqual(clamp01(0.5), 0.5);
  assert.strictEqual(clamp01(1.5), 1);
});

test("sigmoid maps to (0,1)", () => {
  assert.ok(sigmoid(0) > 0 && sigmoid(0) < 1);
  assert.ok(sigmoid(10) > 0.99);
  assert.ok(sigmoid(-10) < 0.01);
});

test("magnitude returns euclidean norm of 3-vec", () => {
  assert.strictEqual(magnitude([3, 4, 0]), 5);
  assert.strictEqual(magnitude([0, 0, 0]), 0);
});

test("distance returns euclidean distance", () => {
  assert.strictEqual(distance([0, 0, 0], [3, 4, 0]), 5);
});

test("confidenceInterval returns [lower, upper] in [0,1]", () => {
  const [lo, hi] = confidenceInterval(0.5, 0.1, 0.9);
  assert.ok(lo >= 0 && lo <= 1);
  assert.ok(hi >= 0 && hi <= 1);
  assert.ok(lo <= 0.5 && hi >= 0.5);
});

test("normalCdf(0) ≈ 0.5", () => {
  const c = normalCdf(0, 0, 1);
  assert.ok(Math.abs(c - 0.5) < 0.01);
});
