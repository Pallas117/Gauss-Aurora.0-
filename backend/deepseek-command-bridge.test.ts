import assert from "node:assert/strict";
import test from "node:test";
import {
  extractChatContent,
  extractFirstJsonObject,
  parseDeepSeekCommandPlan,
} from "./deepseek-command-bridge.js";

test("parseDeepSeekCommandPlan parses direct JSON command response", () => {
  const raw = JSON.stringify({
    command_type: "trigger-nowcast",
    payload: { horizonMinutes: 45 },
    reason: "storm escalation",
    confidence: 0.87,
  });
  const plan = parseDeepSeekCommandPlan(raw);
  assert.ok(plan);
  assert.equal(plan.command_type, "trigger-nowcast");
  assert.equal(plan.payload.horizonMinutes, 45);
  assert.equal(plan.reason, "storm escalation");
  assert.equal(plan.confidence, 0.87);
});

test("parseDeepSeekCommandPlan parses JSON embedded in plain text", () => {
  const raw = [
    "I recommend this command:",
    "```json",
    '{"command_type":"schedule-pass","payload":{"target":"DSCOVR","station":"GAUSS-GS-1"}}',
    "```",
  ].join("\n");
  const plan = parseDeepSeekCommandPlan(raw);
  assert.ok(plan);
  assert.equal(plan.command_type, "schedule-pass");
  assert.equal(plan.payload.target, "DSCOVR");
});

test("parseDeepSeekCommandPlan rejects unknown commands", () => {
  const raw = '{"command_type":"rm -rf","payload":{}}';
  const plan = parseDeepSeekCommandPlan(raw);
  assert.equal(plan, null);
});

test("extractFirstJsonObject finds first object in mixed text", () => {
  const json = extractFirstJsonObject("noise {\"a\":1,\"b\":2} trailing");
  assert.equal(json, "{\"a\":1,\"b\":2}");
});

test("extractChatContent reads OpenAI-compatible choices and fallback fields", () => {
  const fromChoices = extractChatContent({
    choices: [{ message: { content: "hello from choices" } }],
  });
  assert.equal(fromChoices, "hello from choices");

  const fromReasoning = extractChatContent({
    choices: [{ message: { content: "", reasoning: "hello from reasoning" } }],
  });
  assert.equal(fromReasoning, "hello from reasoning");

  const fromFallback = extractChatContent({ output: "hello from fallback" });
  assert.equal(fromFallback, "hello from fallback");
});
