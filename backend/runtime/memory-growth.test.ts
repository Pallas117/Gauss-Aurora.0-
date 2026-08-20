import assert from "node:assert/strict";
import test from "node:test";
import { classifyMemoryGrowth, MemoryGrowthTracker } from "./memory-growth.js";

test("memory growth is unknown until a baseline exists", () => {
  const sample = classifyMemoryGrowth(100, null);
  assert.equal(sample.trend, "unknown");
  assert.equal(sample.growthMb, null);
});

test("positive memory growth is identified for admission control", () => {
  const sample = classifyMemoryGrowth(105, 100);
  assert.equal(sample.growthMb, 5);
  assert.equal(sample.trend, "positive");
});

test("zero or negative growth is safe for bounded scale-out", () => {
  assert.equal(classifyMemoryGrowth(100, 100).trend, "non_positive");
  assert.equal(classifyMemoryGrowth(95, 100).trend, "non_positive");
});

test("tracker keeps only the previous sample", () => {
  const tracker = new MemoryGrowthTracker();
  assert.equal(tracker.sample(100).trend, "unknown");
  assert.equal(tracker.sample(99).trend, "non_positive");
  assert.equal(tracker.sample(101).trend, "positive");
  tracker.reset();
  assert.equal(tracker.sample(101).trend, "unknown");
});
