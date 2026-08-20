import assert from "node:assert/strict";
import test from "node:test";
import { buildFusedTensor } from "./fused-features.js";
import { runFusedModel } from "./fused-model.js";

test("fused model remains local and deterministic without a runner", async () => {
  const tensor = buildFusedTensor({ sequence: [] });
  const result = await runFusedModel(tensor);
  assert.equal(result.fallback, true);
  assert.equal(result.modelVersion, "deterministic-tensor-fallback-v1");
  assert.equal(result.prediction.learnedWeight, 0);
  assert.equal(result.action, "hold");
});

test("learned runner cannot bypass the disagreement calibration gate", async () => {
  const tensor = buildFusedTensor({
    sequence: [],
    reliability: { sourceHealthScore: 0.2 },
  });
  const result = await runFusedModel(tensor, async () => ({
    stormEscalation: 1,
    auroraIntensity: 1,
    mmsReconnection: 1,
    radiationActivity: 1,
  }));
  assert.equal(result.fallback, false);
  assert.equal(result.prediction.degraded, true);
  assert.equal(result.prediction.learnedWeight, 0);
  assert.equal(result.action, "hold");
});
