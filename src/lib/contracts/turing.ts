import { z } from "zod";

const turingDeviceStatusSchema = z.enum(["healthy", "stale", "offline"]);
const turingApprovalStatusSchema = z.enum(["pending", "approved"]);

export const turingDeviceSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  tailscale_ip: z.string(),
  ram_mb: z.number().nullable(),
  ram_used_mb: z.number().nullable(),
  battery_percent: z.number().nullable().optional().default(null),
  charging: z.boolean().nullable().optional().default(null),
  power_source: z.enum(["ac", "battery", "unknown"]).nullable().optional().default(null),
  capabilities: z.array(z.string()),
  last_seen: z.string(),
  status: turingDeviceStatusSchema,
  load: z.number().nullable(),
  current_jobs: z.number().nullable(),
  approval_status: turingApprovalStatusSchema.optional().default("approved"),
});

export const turingDevicesResponseSchema = z.object({
  devices: z.array(turingDeviceSchema),
  generated_at: z.string(),
});

export const turingDevicesSummaryResponseSchema = z.object({
  total: z.number(),
  healthy: z.number(),
  stale: z.number(),
  offline: z.number(),
  pending: z.number().optional().default(0),
  generated_at: z.string(),
});

export const turingJoinCodeResponseSchema = z.object({
  code: z.string(),
  expires_at: z.string(),
  expires_in_sec: z.number(),
});

export type TuringDevice = z.infer<typeof turingDeviceSchema>;
export type TuringDevicesResponse = z.infer<typeof turingDevicesResponseSchema>;
export type TuringDevicesSummaryResponse = z.infer<typeof turingDevicesSummaryResponseSchema>;
export type TuringJoinCodeResponse = z.infer<typeof turingJoinCodeResponseSchema>;

export function parseTuringDevicesResponse(input: unknown): TuringDevicesResponse {
  return turingDevicesResponseSchema.parse(input);
}

export function parseTuringDevicesSummaryResponse(input: unknown): TuringDevicesSummaryResponse {
  return turingDevicesSummaryResponseSchema.parse(input);
}

export function parseTuringJoinCodeResponse(input: unknown): TuringJoinCodeResponse {
  return turingJoinCodeResponseSchema.parse(input);
}
