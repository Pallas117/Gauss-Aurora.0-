import { describe, expect, it } from "@jest/globals";
import { frameFromTelemetry, isMhdFixtureFrame, MHD_FIELD_LINE_SAMPLES, MHD_FIXTURE_SCHEMA } from "./mhd-fixture";

describe("deterministic MHD fixture contract", () => {
  it("produces the same bounded frame for the same telemetry", () => {
    const input = { dynamicPressureNpa: 3.2, imfBzNt: -8, protonDensityCm3: 7, sampleIndex: 4 };
    const first = frameFromTelemetry(input);
    const second = frameFromTelemetry(input);
    expect(first).toEqual(second);
    expect(first.fieldLineRadiiRe).toHaveLength(MHD_FIELD_LINE_SAMPLES);
    expect(isMhdFixtureFrame(first)).toBe(true);
    expect(MHD_FIXTURE_SCHEMA).toBe("gauss-mhd-fixture-v1");
  });

  it("fails closed to bounded defaults for invalid numeric inputs", () => {
    const frame = frameFromTelemetry({ dynamicPressureNpa: Number.NaN, imfBzNt: Number.POSITIVE_INFINITY });
    expect(isMhdFixtureFrame(frame)).toBe(true);
    expect(frame.sampleIndex).toBe(0);
  });
});
