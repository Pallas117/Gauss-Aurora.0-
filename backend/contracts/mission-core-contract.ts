import { z } from "zod";

const numberSchema = z.number().finite();

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

const observationRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["space-weather", "mms-reconnection", "aurora-map"]),
  timestamp: z.string().min(1),
  source: z.string().min(1),
  confidence: numberSchema.min(0).max(1),
  stale: z.boolean(),
});

const missionTrackSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["space-weather-driver", "reconnection-front"]),
  state: z.enum(["confirmed", "predicted", "stale"]),
  confidence: numberSchema.min(0).max(1),
  observationIds: z.array(z.string().min(1)),
  summary: z.string().min(1),
});

const threatSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  probability: numberSchema.min(0).max(1),
  confidence_interval: z.tuple([numberSchema.min(0).max(1), numberSchema.min(0).max(1)]),
  composite_score: numberSchema.min(0).max(1),
  actionable: z.boolean(),
  recommended_action: z.string().min(1),
});

const missionPassSchema = z.object({
  passId: z.string().min(1),
  target: z.string().min(1),
  station: z.string().min(1),
  aos: z.string().min(1),
  los: z.string().min(1),
  status: z.enum(["planned", "scheduled", "active", "completed"]),
  mode: z.enum(["placeholder", "external"]),
  priority: z.number().int().min(1).max(10),
});

const missionCommandSchema = z.object({
  commandId: z.string().min(1),
  commandType: z.enum(["trigger-nowcast", "schedule-pass", "log-health-check"]),
  status: z.enum(["proposed", "ready", "blocked"]),
  requiresRole: z.enum(["viewer", "operator", "admin"]),
  reason: z.string().min(1),
});

export const missionCoreSnapshotContract = z.object({
  timestamp: z.string().min(1),
  source: z.enum(["memory", "supabase"]),
  observation: z.object({
    refs: z.array(observationRefSchema),
    canonicalLatest: z.object({
      timestamp: z.string().min(1),
      source: z.string().min(1),
      alerts: z.object({
        stormTier: z.enum(["quiet", "watch", "warning", "severe"]),
      }),
      quality: z.object({
        stale: z.boolean(),
        lowConfidence: z.boolean(),
      }),
    }).passthrough(),
    mmsLatest: z
      .object({
        timestamp: z.string().min(1),
        quality: z.object({
          valid: z.boolean(),
          confidence: z.enum(["high", "medium", "low"]),
        }),
      })
      .passthrough()
      .nullable(),
    auroraLatest: z
      .object({
        timestamp: z.string().min(1),
        nside: z.number().int().positive(),
        grid: z.array(z.unknown()),
      })
      .passthrough()
      .nullable(),
    sourceStatus: z.array(sourceStatusSchema),
    freshness: z.object({
      canonicalAgeSeconds: z.number().nullable(),
      mmsAgeSeconds: z.number().nullable(),
      auroraAgeSeconds: z.number().nullable(),
    }),
  }),
  tracks: z.array(missionTrackSchema),
  threats: z.array(threatSchema),
  passes: z.array(missionPassSchema),
  commands: z.array(missionCommandSchema),
  actions: z.object({
    gateAction: z.enum(["TRIGGER_LLM", "LOG_AND_SLEEP"]),
    stormTier: z.enum(["quiet", "watch", "warning", "severe"]),
    primaryAction: z.string().min(1),
  }),
  auth: z.object({
    role: z.enum(["viewer", "operator", "admin"]).nullable(),
    clearance: z.enum(["public", "mission", "restricted"]).nullable().optional(),
    userId: z.string().nullable(),
  }),
});

export type MissionCoreSnapshotContract = z.infer<typeof missionCoreSnapshotContract>;

export function assertMissionCoreSnapshotContract(
  payload: unknown,
): MissionCoreSnapshotContract {
  return missionCoreSnapshotContract.parse(payload);
}
