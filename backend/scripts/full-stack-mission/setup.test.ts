import assert from "node:assert/strict";
import test from "node:test";
import { envValue, isTruthy, loadMissionConfig } from "./setup.js";

test("loadMissionConfig returns object with required keys", () => {
  const config = loadMissionConfig();
  assert.ok("frontendUrl" in config);
  assert.ok("backendUrl" in config);
  assert.ok("brainUrl" in config);
  assert.ok("ragUrl" in config);
  assert.ok("writeMode" in config);
  assert.ok("cleanup" in config);
  assert.ok("runTrainCheck" in config);
  assert.ok("runUiE2E" in config);
  assert.ok("runUiMobile" in config);
  assert.strictEqual(typeof config.frontendUrl, "string");
  assert.strictEqual(typeof config.backendUrl, "string");
});

test("envValue returns first defined env value", () => {
  const prev = process.env.TEST_ENV_KEY;
  try {
    process.env.TEST_ENV_KEY = "  value  ";
    assert.strictEqual(envValue("TEST_ENV_KEY"), "value");
    assert.strictEqual(envValue("MISSING", "TEST_ENV_KEY"), "value");
    assert.strictEqual(envValue("MISSING"), null);
  } finally {
    if (prev !== undefined) process.env.TEST_ENV_KEY = prev;
    else delete process.env.TEST_ENV_KEY;
  }
});

test("isTruthy recognizes 1, true, yes, on", () => {
  assert.strictEqual(isTruthy("1"), true);
  assert.strictEqual(isTruthy("true"), true);
  assert.strictEqual(isTruthy("yes"), true);
  assert.strictEqual(isTruthy("on"), true);
  assert.strictEqual(isTruthy("0"), false);
  assert.strictEqual(isTruthy("false"), false);
  assert.strictEqual(isTruthy(null), false);
});
