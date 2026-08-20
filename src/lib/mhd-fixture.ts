export const MHD_FIXTURE_SCHEMA = "gauss-mhd-fixture-v1" as const;
export const MHD_FIELD_LINE_SAMPLES = 16 as const;

export type MhdFixtureFrame = {
  sampleIndex: number;
  pressureNormalized: number;
  standOffRe: number;
  tailLengthRe: number;
  reconnection: number;
  beltIntensity: number;
  fieldLineRadiiRe: number[];
};

export type MhdFixtureEnvelope = {
  schema: typeof MHD_FIXTURE_SCHEMA;
  units: { distance: "Re"; pressure: "nPa" };
  frames: MhdFixtureFrame[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function frameFromTelemetry(input: {
  dynamicPressureNpa?: number | null;
  imfBzNt?: number | null;
  protonDensityCm3?: number | null;
  sampleIndex?: number;
}): MhdFixtureFrame {
  const pressure = clamp(Number.isFinite(input.dynamicPressureNpa) ? Number(input.dynamicPressureNpa) : 2, 0.05, 100);
  const bz = clamp(Number.isFinite(input.imfBzNt) ? Number(input.imfBzNt) : 0, -100, 100);
  const density = clamp(Number.isFinite(input.protonDensityCm3) ? Number(input.protonDensityCm3) : 5, 0, 1000);
  const pressureNormalized = clamp(pressure / 10, 0, 1);
  const standOffRe = clamp(10.2 * Math.pow(pressure, -1 / 6), 5, 15);
  const reconnection = clamp(-bz / 15, 0, 1);
  const beltIntensity = clamp(0.15 + density / 100 + reconnection * 0.35, 0, 1);
  const tailLengthRe = clamp(24 + pressureNormalized * 18 + reconnection * 18, 20, 64);
  const fieldLineRadiiRe = Array.from({ length: MHD_FIELD_LINE_SAMPLES }, (_, index) => {
    const phase = index / (MHD_FIELD_LINE_SAMPLES - 1);
    const latitude = -Math.PI / 2 + phase * Math.PI;
    return clamp(standOffRe * (0.72 + 0.28 * Math.cos(latitude) ** 2), 3.5, 15);
  });

  return {
    sampleIndex: Math.max(0, Math.floor(input.sampleIndex ?? 0)),
    pressureNormalized,
    standOffRe,
    tailLengthRe,
    reconnection,
    beltIntensity,
    fieldLineRadiiRe,
  };
}

export function isMhdFixtureFrame(value: unknown): value is MhdFixtureFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<MhdFixtureFrame>;
  return Number.isInteger(frame.sampleIndex) &&
    Number.isFinite(frame.pressureNormalized) && frame.pressureNormalized >= 0 && frame.pressureNormalized <= 1 &&
    Number.isFinite(frame.standOffRe) && frame.standOffRe >= 5 && frame.standOffRe <= 15 &&
    Number.isFinite(frame.tailLengthRe) && frame.tailLengthRe >= 20 && frame.tailLengthRe <= 64 &&
    Number.isFinite(frame.reconnection) && frame.reconnection >= 0 && frame.reconnection <= 1 &&
    Number.isFinite(frame.beltIntensity) && frame.beltIntensity >= 0 && frame.beltIntensity <= 1 &&
    Array.isArray(frame.fieldLineRadiiRe) && frame.fieldLineRadiiRe.length === MHD_FIELD_LINE_SAMPLES &&
    frame.fieldLineRadiiRe.every((radius) => Number.isFinite(radius) && radius >= 3.5 && radius <= 15);
}
