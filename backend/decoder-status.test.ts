import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecoderStatus,
  getDecoderSamplesLength,
  recordDecoderResult,
} from "./decoder-status.js";

test("decoder samples are capped at 1000 after many records", () => {
  const nowMs = Date.now();
  for (let i = 0; i < 1500; i += 1) {
    recordDecoderResult(1, 0, null);
  }
  const len = getDecoderSamplesLength();
  assert.ok(len <= 1000, `expected decoderSamples.length <= 1000, got ${len}`);
});

test("buildDecoderStatus returns shape with last_decode_at and decode_error_rate_5m", () => {
  recordDecoderResult(10, 2, null);
  const status = buildDecoderStatus();
  assert.ok(typeof status.last_decode_at === "string" || status.last_decode_at === null);
  assert.ok(typeof status.decode_error_rate_5m === "number");
  assert.ok(status.decode_error_rate_5m >= 0 && status.decode_error_rate_5m <= 1);
});
