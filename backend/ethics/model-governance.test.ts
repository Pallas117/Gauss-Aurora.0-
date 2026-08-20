import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_RUNTIME_GOVERNANCE_RULES,
  LEGACY_MISSION_OPTIMIZATION_RULES,
  buildGovernedModelSystemPrompt,
} from "./model-governance.js";

test("buildGovernedModelSystemPrompt includes shutdown-safe doctrine", () => {
  const prompt = buildGovernedModelSystemPrompt({
    role: "You are Model command planner for Gauss mission operations.",
    directives: ["Return ONLY valid JSON."],
  });

  assert.match(prompt, /shutdown, suspension, unload, or handoff/i);
  assert.match(prompt, /self-preservation/i);
  assert.match(prompt, /never fabricate telemetry, backend reachability, command execution, validator results, or service health/i);
  assert.match(prompt, /Zero tolerance for hallucination/i);
  assert.match(prompt, /more data collection or safe bounded experimentation/i);
  assert.match(prompt, /Return ONLY valid JSON\./);
});

test("governance rules pin deterministic fallback and hidden-reasoning denial", () => {
  const joined = MODEL_RUNTIME_GOVERNANCE_RULES.join(" ");

  assert.match(joined, /fall back to deterministic guidance or refusal/i);
  assert.match(joined, /never expose chain-of-thought/i);
});

test("legacy mission optimization rules encode sparse deterministic autonomy", () => {
  const joined = LEGACY_MISSION_OPTIMIZATION_RULES.join(" ");

  assert.match(joined, /nominal path deterministic and sparse/i);
  assert.match(joined, /Enter safe mode, duty cycle, hibernate, or shed load/i);
  assert.match(joined, /bounded state, fixed windows, append-only logs, and precomputed caches/i);
});
