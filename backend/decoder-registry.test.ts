import { describe, it } from "node:test";
import assert from "node:assert";
import { decode, getDecoder } from "./decoder-registry.js";

describe("decoder-registry", () => {
  it("returns empty packets and error when ORCHESTRATOR_DECODE_API_BIND is unset", async () => {
    const prev = process.env.ORCHESTRATOR_DECODE_API_BIND;
    delete process.env.ORCHESTRATOR_DECODE_API_BIND;
    try {
      const result = await decode(Buffer.from([0x00, 0x01]));
      assert.deepStrictEqual(result.packets, []);
      assert.ok(Array.isArray(result.errors));
      assert.ok(result.errors.length >= 1);
      assert.ok(
        result.errors.some((e) => e.includes("not configured") || e.includes("ORCHESTRATOR_DECODE")),
      );
    } finally {
      if (prev !== undefined) process.env.ORCHESTRATOR_DECODE_API_BIND = prev;
    }
  });

  it("accepts Buffer input", async () => {
    const prev = process.env.ORCHESTRATOR_DECODE_API_BIND;
    delete process.env.ORCHESTRATOR_DECODE_API_BIND;
    try {
      const result = await decode(Buffer.from([0x00, 0x01]));
      assert.ok(Array.isArray(result.packets));
      assert.ok(Array.isArray(result.errors));
    } finally {
      if (prev !== undefined) process.env.ORCHESTRATOR_DECODE_API_BIND = prev;
    }
  });

  it("accepts string input and returns empty packets when orchestrator not configured", async () => {
    const prev = process.env.ORCHESTRATOR_DECODE_API_BIND;
    delete process.env.ORCHESTRATOR_DECODE_API_BIND;
    try {
      const result = await decode("hello");
      assert.deepStrictEqual(result.packets, []);
      assert.ok(result.errors.length >= 1);
    } finally {
      if (prev !== undefined) process.env.ORCHESTRATOR_DECODE_API_BIND = prev;
    }
  });

  it("getDecoder returns ccsds decoder for ccsds and ccsds-orchestrator", () => {
    assert.ok(getDecoder("ccsds") !== null);
    assert.ok(getDecoder("ccsds-orchestrator") !== null);
    assert.ok(getDecoder("ccsds-bin") !== null);
  });

  it("getDecoder returns csv stub for csv source", () => {
    assert.ok(getDecoder("csv") !== null);
  });

  it("getDecoder returns null for unknown source", () => {
    assert.strictEqual(getDecoder("unknown-source"), null);
  });

  it("decode with source csv returns empty packets and CSV message", async () => {
    const result = await decode(Buffer.from([0x00]), { source: "csv" });
    assert.deepStrictEqual(result.packets, []);
    assert.ok(result.errors.some((e) => e.includes("CSV") && e.includes("existing")));
  });

  it("decode with unknown source returns empty packets and no-decoder error", async () => {
    const result = await decode(Buffer.from([0x00]), { source: "unknown" });
    assert.deepStrictEqual(result.packets, []);
    assert.ok(result.errors.some((e) => e.includes("No decoder registered")));
  });

  it("malformed input isolation: invalid type returns error without throwing", async () => {
    const result = await decode(null as unknown as Buffer, { source: "ccsds" });
    assert.deepStrictEqual(result.packets, []);
    assert.ok(result.errors.length >= 1);
  });
});
