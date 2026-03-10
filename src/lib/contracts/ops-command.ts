import { z } from "zod";
import {
  authSessionResponseSchema,
  dashboardLatestResponseSchema,
} from "@/lib/contracts/heliophysics";

const timestampSchema = z.string().min(1);

const cyberTigerStatusSchema = z
  .object({
    enabled: z.boolean(),
    counters: z
      .object({
        totalInspected: z.number().int().nonnegative().optional(),
        blocked: z.number().int().nonnegative().optional(),
        signatureHits: z.number().int().nonnegative().optional(),
        rateLimited: z.number().int().nonnegative().optional(),
        authFailures: z.number().int().nonnegative().optional(),
        activeBlocks: z.number().int().nonnegative().optional(),
        storedEvents: z.number().int().nonnegative().optional(),
      })
      .partial()
      .optional(),
    activeBlocks: z
      .array(
        z.object({
          ip: z.string(),
          until: timestampSchema,
          reason: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough();

const opsCommandStatusChipSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(["ok", "warn", "critical", "info"]),
  value: z.string().optional(),
});

const dtnIslAuditControlSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  details: z.string().min(1),
});

const dtnIslAuditStatusSchema = z.object({
  configured: z.boolean(),
  reachable: z.boolean(),
  generated_at: timestampSchema.nullable(),
  readiness_score: z.number().min(0).max(100),
  pass: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  controls: z.array(dtnIslAuditControlSchema),
  last_error: z.string().nullable(),
});

export const opsCommandSnapshotResponseSchema = z.object({
  updatedAt: timestampSchema,
  session: authSessionResponseSchema,
  sourceStatus: dashboardLatestResponseSchema.shape.sourceStatus,
  canonicalLatest: dashboardLatestResponseSchema.shape.canonicalLatest,
  mmsLatest: dashboardLatestResponseSchema.shape.mmsLatest,
  auroraLatest: dashboardLatestResponseSchema.shape.auroraLatest,
  threatSummary: dashboardLatestResponseSchema.shape.threatSummary,
  dtnIslStatus: dtnIslAuditStatusSchema,
  cybertigerStatus: cyberTigerStatusSchema.nullable(),
  statusChips: z.array(opsCommandStatusChipSchema).optional(),
});

export type OpsCommandStatusChip = z.infer<typeof opsCommandStatusChipSchema>;
export type OpsCommandSnapshotResponse = z.infer<typeof opsCommandSnapshotResponseSchema>;

export function parseOpsCommandSnapshotResponse(input: unknown): OpsCommandSnapshotResponse {
  return opsCommandSnapshotResponseSchema.parse(input);
}
