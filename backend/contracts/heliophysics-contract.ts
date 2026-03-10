import { z } from "zod";

const sourceStatusSchema = z.object({
  source: z.string(),
  lastSeen: z.string().nullable(),
  latencySeconds: z.number().nullable(),
  healthy: z.boolean(),
  message: z.string().optional(),
  powerDecision: z.enum(["primary", "validate", "sample", "suspend"]).optional(),
  utilityScore: z.number().finite().optional(),
  targetCadenceMs: z.number().finite().nullable().optional(),
  policyReason: z.string().optional(),
  observedCostScore: z.number().finite().optional(),
  avgFetchDurationMs: z.number().finite().optional(),
  avgCpuMs: z.number().finite().optional(),
  avgPayloadKb: z.number().finite().optional(),
  sampleCount: z.number().int().nonnegative().optional(),
  overrideDecision: z.enum(["primary", "validate", "sample", "suspend"]).nullable().optional(),
  overrideTargetCadenceMs: z.number().finite().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overrideUpdatedAt: z.string().nullable().optional(),
  overrideUpdatedBy: z.string().nullable().optional(),
});

export const sourceStatusResponseContract = z.object({
  timestamp: z.string().min(1),
  sources: z.array(sourceStatusSchema),
  auth: z.object({
    userId: z.string().nullable(),
    role: z.string().nullable(),
    clearance: z.enum(["public", "mission", "restricted"]).nullable().optional(),
  }),
});

export type SourceStatusResponseContract = z.infer<typeof sourceStatusResponseContract>;

export function assertSourceStatusResponseContract(
  payload: unknown,
): SourceStatusResponseContract {
  return sourceStatusResponseContract.parse(payload);
}
