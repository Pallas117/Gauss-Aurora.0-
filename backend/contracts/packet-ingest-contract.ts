import { z } from "zod";

const finiteNumber = z.number().finite();

const packetQualityFlagsSchema = z.object({
  crc_checked: z.boolean(),
  crc_valid: z.boolean().nullable().optional(),
  missing_parameters: z.boolean(),
});

const packetUncertaintySchema = z.object({
  speed: z.object({ sigma: finiteNumber }).passthrough().optional(),
  density: z.object({ sigma: finiteNumber }).passthrough().optional(),
  bz: z.object({ sigma: finiteNumber }).passthrough().optional(),
}).passthrough();

const canonicalPointSchema = z.object({
  timestamp: z.string().min(1),
  solarWind: z.object({
    speed: finiteNumber,
    density: finiteNumber,
  }).passthrough(),
  magneticField: z.object({
    z: finiteNumber,
  }).passthrough(),
}).passthrough();

const packetSchema = z.object({
  timestamp: z.string().min(1),
  apid: z.number().int().min(0).max(2047),
  seq_count: z.number().int().min(0).max(16383),
  payload_hex: z.string().regex(/^[0-9A-Fa-f]*$/),
  canonical_point: canonicalPointSchema,
  quality_flags: packetQualityFlagsSchema,
  uncertainty: packetUncertaintySchema,
});

export const packetIngestRequestContract = z.object({
  run_id: z.string().min(1),
  source: z.string().min(1),
  format: z.enum(["ccsds-bin", "ccsds-hex"]),
  dictionary_id: z.string().min(1),
  packets: z.array(packetSchema).max(10_000),
});

export const packetIngestResponseContract = z.object({
  accepted_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  errors: z.array(z.object({
    index: z.number().int().nonnegative(),
    code: z.string().min(1),
    reason: z.string().min(1),
  })),
});

export type PacketIngestRequestContract = z.infer<typeof packetIngestRequestContract>;
export type PacketIngestResponseContract = z.infer<typeof packetIngestResponseContract>;

/** Refine endpoint: same request as ingest; returns refined packets + counts. */
export const telemetryRefineRequestContract = packetIngestRequestContract;
export const telemetryRefineResponseContract = z.object({
  packets: z.array(packetSchema).max(10_000),
  clamped_count: z.number().int().nonnegative(),
  interpolated_count: z.number().int().nonnegative(),
});

export type TelemetryRefineRequestContract = z.infer<typeof telemetryRefineRequestContract>;
export type TelemetryRefineResponseContract = z.infer<typeof telemetryRefineResponseContract>;

export function assertPacketIngestRequestContract(payload: unknown): PacketIngestRequestContract {
  return packetIngestRequestContract.parse(payload);
}

export function assertPacketIngestResponseContract(payload: unknown): PacketIngestResponseContract {
  return packetIngestResponseContract.parse(payload);
}
