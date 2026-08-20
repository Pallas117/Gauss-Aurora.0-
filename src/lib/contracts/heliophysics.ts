import { z } from "zod";

const numberSchema = z.number().finite();
const timestampSchema = z.string().min(1);

const vector3Schema = z.object({
  x: numberSchema,
  y: numberSchema,
  z: numberSchema,
});

const uncertaintyEnvelopeSchema = z.object({
  lower: numberSchema,
  upper: numberSchema,
  sigma: numberSchema,
});

const qualityFlagsSchema = z.object({
  outlier: z.boolean(),
  stale: z.boolean(),
  interpolated: z.boolean(),
  extrapolated: z.boolean(),
  lowConfidence: z.boolean(),
});

export const canonicalSpaceWeatherPointSchema = z.object({
  timestamp: timestampSchema,
  source: z.string(),
  rho: numberSchema,
  velocity: vector3Schema.extend({
    magnitude: numberSchema,
  }),
  magneticField: vector3Schema.extend({
    bt: numberSchema,
  }),
  electricField: vector3Schema.extend({
    ey: numberSchema,
  }),
  solarWind: z.object({
    speed: numberSchema,
    density: numberSchema,
    dynamicPressure: numberSchema,
  }),
  indices: z.object({
    kp: numberSchema,
    dst: numberSchema,
  }),
  coupling: z.object({
    newell: numberSchema,
    epsilon: numberSchema,
  }),
  propagation: z.object({
    l1DelaySeconds: numberSchema,
    etaEarthArrival: timestampSchema,
  }),
  alerts: z.object({
    stormTier: z.enum(["quiet", "watch", "warning", "severe"]),
    reason: z.string(),
  }),
  quality: qualityFlagsSchema,
  uncertainty: z.object({
    speed: uncertaintyEnvelopeSchema,
    density: uncertaintyEnvelopeSchema,
    bz: uncertaintyEnvelopeSchema,
  }),
  diagnostics: z
    .object({
      shueR0Re: numberSchema.optional(),
      alfvenSpeedKmS: numberSchema.optional(),
      clockAngleRad: numberSchema.optional(),
    })
    .optional(),
  radiation: z
    .object({
      protonFlux10MeV: numberSchema,
      electronFlux2MeV: numberSchema,
      observedAt: timestampSchema,
      source: z.string(),
      platform: z.enum(["primary", "secondary"]).optional(),
    })
    .optional(),
  supplementalRadiation: z
    .array(z.object({
      observedAt: timestampSchema,
      source: z.string(),
      dataset: z.string(),
      platform: z.string().optional(),
      protonFlux: numberSchema,
      electronFlux: numberSchema,
      protonEnergy: z.string(),
      electronEnergy: z.string(),
    }))
    .optional(),
});

export const mmsReconVectorPointSchema = z.object({
  timestamp: timestampSchema,
  barycenterGsmRe: vector3Schema,
  currentDensity: vector3Schema.extend({
    magnitude: numberSchema,
  }),
  normal: vector3Schema,
  lmn: z.object({
    l: vector3Schema,
    m: vector3Schema,
    n: vector3Schema,
  }),
  quality: z.object({
    valid: z.boolean(),
    volume: numberSchema,
    conditionNumber: numberSchema,
    divCurlRatio: numberSchema,
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string().optional(),
  }),
  probability: z
    .object({
      reconnection: numberSchema,
      confidence: numberSchema,
      lower: numberSchema,
      upper: numberSchema,
      driver: z.enum(["measured", "predicted", "fused"]),
      factors: z.object({
        southwardImf: numberSchema,
        electricDriver: numberSchema,
        coupling: numberSchema,
        tetraQuality: numberSchema,
        sampleCoverage: numberSchema,
        burstBoost: numberSchema,
        freshnessPenalty: numberSchema,
      }),
    })
    .optional(),
  directionality: z
    .object({
      corrected: z.boolean(),
      alignment: numberSchema,
      referenceVector: z.enum(["electric-field", "magnetic-field", "history"]),
      reason: z.string(),
    })
    .optional(),
  provenance: z
    .object({
      mode: z.enum(["measured", "predicted", "fused"]),
      sampleCount: numberSchema,
      burstMode: z.boolean(),
    })
    .optional(),
});

const auroraGridPointSchema = z.object({
  lat: numberSchema,
  lon: numberSchema,
  probability: numberSchema,
  energyFlux: numberSchema,
});

const harmonicsSchema = z.object({
  lMax: z.number().int().nonnegative(),
  coefficients: z.array(
    z.object({
      l: z.number().int().nonnegative(),
      m: z.number().int(),
      re: numberSchema,
      im: numberSchema,
    }),
  ),
  powerSpectrum: z.array(
    z.object({
      l: z.number().int().nonnegative(),
      cL: numberSchema,
    }),
  ),
});

export const auroraMapResponseSchema = z.object({
  timestamp: timestampSchema,
  nside: z.number().int().positive(),
  grid: z.array(auroraGridPointSchema),
  harmonics: harmonicsSchema,
  projection: z.string().optional(),
  requestedTimestamp: z.string().nullable().optional(),
});

const sourceStatusSchema = z.object({
  source: z.string(),
  lastSeen: z.string().nullable(),
  latencySeconds: z.number().nullable(),
  healthy: z.boolean(),
  message: z.string().optional(),
  powerDecision: z.enum(["primary", "validate", "sample", "suspend"]).optional(),
  utilityScore: numberSchema.optional(),
  targetCadenceMs: numberSchema.nullable().optional(),
  policyReason: z.string().optional(),
  observedCostScore: numberSchema.optional(),
  avgFetchDurationMs: numberSchema.optional(),
  avgCpuMs: numberSchema.optional(),
  avgPayloadKb: numberSchema.optional(),
  sampleCount: z.number().int().nonnegative().optional(),
  overrideDecision: z.enum(["primary", "validate", "sample", "suspend"]).nullable().optional(),
  overrideTargetCadenceMs: numberSchema.nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overrideUpdatedAt: z.string().nullable().optional(),
  overrideUpdatedBy: z.string().nullable().optional(),
});

const clearanceSchema = z.enum(["public", "mission", "restricted"]);

const vectorDirectionSchema = z.object({
  x: numberSchema,
  y: numberSchema,
  z: numberSchema,
  magnitude: numberSchema,
});

const vectorOverlaySnapshotSchema = z.object({
  timestamp: timestampSchema,
  referenceFrame: z.literal("GSM"),
  solarWindDirection: vectorDirectionSchema,
  electricFieldDirection: vectorDirectionSchema,
  imfDirection: vectorDirectionSchema,
  cmeProxy: z.object({
    direction: vectorDirectionSchema,
    coneWidthDeg: numberSchema,
    confidence: numberSchema,
    driver: z.string(),
  }),
  mms: z
    .object({
      normalDirection: vectorDirectionSchema,
      currentDirection: vectorDirectionSchema,
      quality: z.enum(["high", "medium", "low"]),
      provenance: z.enum(["measured", "predicted", "fused"]),
    })
    .nullable(),
  riskVector: z.object({
    recommendedAction: z.string(),
    type: z.string(),
    compositeScore: numberSchema,
    actionable: z.boolean(),
  }),
});

const sessionFeaturesSchema = z
  .object({
    heliophysics: z.boolean(),
    debris: z.boolean(),
  })
  .optional();

export const authSessionResponseSchema = z.object({
  authRequired: z.boolean(),
  authenticated: z.boolean(),
  role: z.enum(["viewer", "operator", "admin"]).nullable(),
  clearance: clearanceSchema.nullable().optional(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean().optional(),
  features: sessionFeaturesSchema,
  message: z.string().optional(),
  error: z.string().optional(),
});

export const sourceStatusResponseSchema = z.object({
  timestamp: timestampSchema,
  sources: z.array(sourceStatusSchema),
  auth: z
    .object({
      userId: z.string().nullable(),
      role: z.string().nullable(),
      clearance: clearanceSchema.nullable().optional(),
    })
    .optional(),
});

const threatFactorSchema = z.object({
  name: z.string(),
  weight: numberSchema,
  value: numberSchema,
  contribution: numberSchema,
  unit: z.string().optional(),
});

const threatRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  probability: numberSchema,
  confidence_interval: z.tuple([numberSchema, numberSchema]),
  factors: z.array(threatFactorSchema),
  composite_score: numberSchema,
  actionable: z.boolean(),
  recommended_action: z.string(),
});

const riskZoneSnapshotSchema = z.object({
  riskZones: z.array(
    z.object({
      orbitType: z.enum(["MEO", "GEO"]),
      altitudeKm: numberSchema,
      latitudeDeg: numberSchema.optional(),
      longitudeDeg: numberSchema.optional(),
      riskScore: numberSchema,
      objectCount: z.number().int().nonnegative().optional(),
    }),
  ),
  updatedAt: timestampSchema,
});

const satelliteObjectSchema = z.object({
  noradId: z.string(),
  name: z.string(),
  orbitType: z.enum(["LEO", "MEO", "GEO"]),
  altitudeKm: numberSchema,
  latitudeDeg: numberSchema,
  longitudeDeg: numberSchema,
  highValue: z.boolean(),
  unidentified: z.boolean(),
});

const satelliteObjectsSnapshotSchema = z.object({
  objects: z.array(satelliteObjectSchema),
  highValue: z.array(satelliteObjectSchema),
  unidentified: z.array(satelliteObjectSchema),
  updatedAt: timestampSchema,
});

const spaceDomainSummarySchema = z.object({
  updatedAt: timestampSchema.nullable(),
  freshness: z.object({
    riskZonesAgeSeconds: z.number().nullable(),
    satellitesAgeSeconds: z.number().nullable(),
    conjunctionsAgeSeconds: z.number().nullable(),
  }),
  availability: z.object({
    riskZones: z.boolean(),
    satellites: z.boolean(),
    conjunctions: z.boolean(),
  }),
  counts: z.object({
    riskZoneCount: z.number().int().nonnegative(),
    satelliteObjectCount: z.number().int().nonnegative(),
    highValueCount: z.number().int().nonnegative(),
    unidentifiedCount: z.number().int().nonnegative(),
    conjunctionCount: z.number().int().nonnegative(),
  }),
  crowding: z.object({
    maxRiskScore: numberSchema,
    avgRiskScore: numberSchema,
    geoMaxRiskScore: numberSchema,
    meoMaxRiskScore: numberSchema,
    weightedObjectDensity: numberSchema,
    unidentifiedRatio: numberSchema,
  }),
  conjunctionRisk: z.object({
    maxCollisionProbability: numberSchema.nullable(),
    minMissDistanceM: numberSchema.nullable(),
    recentCriticalCount: z.number().int().nonnegative(),
  }),
  learnedLane: z.object({
    modelVersion: z.string(),
    score: numberSchema,
    confidence: numberSchema,
    trigger: z.boolean(),
    threshold: numberSchema,
    blend: numberSchema,
    features: z.object({
      conjunctionCount: numberSchema,
      maxCollisionProbability: numberSchema,
      inverseMissDistance: numberSchema,
      debrisDensity: numberSchema,
      highValueNeighborDensity: numberSchema,
      unidentifiedRatio: numberSchema,
      geoCrowdingScore: numberSchema,
      meoCrowdingScore: numberSchema,
      leoCrowdingScore: numberSchema,
      tleFreshnessScore: numberSchema,
      conjunctionFreshnessScore: numberSchema,
      availabilityScore: numberSchema,
    }),
    topContributors: z.array(
      z.object({
        name: z.string(),
        weight: numberSchema,
        value: numberSchema,
        contribution: numberSchema,
      }),
    ),
  }),
});

const publicSpaceDomainSnapshotSchema = z.object({
  updatedAt: timestampSchema.nullable(),
  riskZones: riskZoneSnapshotSchema.nullable(),
  satellites: satelliteObjectsSnapshotSchema.nullable(),
  conjunctions: z.object({
    updatedAt: timestampSchema.nullable(),
    count: z.number().int().nonnegative(),
  }),
});

const spaceDomainAvailabilitySchema = z.object({
  mode: z.enum(["live", "projected", "warming"]),
  lastLiveAt: timestampSchema.nullable(),
  dataAgeSeconds: z.number().nullable(),
  reason: z.enum(["ok", "ingest_empty", "ingest_stale", "memory_suppressed"]),
  projectionMethod: z.enum(["sgp4", "hold"]).nullable(),
});

const spaceDomainAnalysisSchema = z.object({
  generatedAt: timestampSchema,
  cadenceSeconds: z.number().int().positive(),
  source: z.enum(["deterministic", "hybrid"]),
  severity: z.enum(["quiet", "watch", "warning", "critical"]),
  headline: z.string(),
  summary: z.string(),
  confidence: numberSchema,
  changed: z.boolean(),
  changedSignals: z.array(z.string()),
  metrics: z.object({
    learnedLaneScore: numberSchema,
    maxRiskScore: numberSchema,
    maxCollisionProbability: numberSchema.nullable(),
    minMissDistanceM: numberSchema.nullable(),
    conjunctionCount: z.number().int().nonnegative(),
  }),
  model: z.object({
    used: z.boolean(),
    modelId: z.string().nullable(),
    generatedAt: timestampSchema.nullable(),
  }),
});

const sevenZoneEvidenceSchema = z.object({
  source: z.string(),
  observedAt: timestampSchema.nullable(),
  provenanceRefs: z.array(z.string()),
  quality: z.enum(["unknown", "low", "high"]).optional(),
});

const sevenZoneResultSchema = z.object({
  id: z.enum(["A", "B", "C", "D", "E", "F", "G"]),
  name: z.string(),
  applicability: z.enum(["required", "advisory", "not_applicable"]),
  state: z.enum(["nominal", "degraded", "unknown", "blocked"]),
  evidence: z.array(sevenZoneEvidenceSchema),
  reasons: z.array(z.string()),
  blockers: z.array(z.string()),
});

export const sevenZoneAssessmentSchema = z.object({
  schema: z.literal("gauss-seven-zone-v1"),
  assessmentId: z.string(),
  generatedAt: timestampSchema,
  missionId: z.string(),
  deploymentScope: z.enum(["ground_only", "simulator", "hosted_payload", "flight_candidate"]),
  mode: z.enum(["environmental_screening", "mission_qualification"]),
  qualificationEvidence: z.boolean(),
  zones: z.array(sevenZoneResultSchema).length(7),
  aggregateState: z.enum(["nominal", "degraded", "unknown", "blocked"]),
  decision: z.enum(["qualified", "screened", "unknown", "blocked"]),
  blockers: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const spaceDomainResponseSchema = z.object({
  snapshot: publicSpaceDomainSnapshotSchema,
  availability: spaceDomainAvailabilitySchema,
  summary: spaceDomainSummarySchema,
  analysis: spaceDomainAnalysisSchema,
});

export const threatSummaryResponseSchema = z.object({
  timestamp: timestampSchema,
  source: z.string(),
  lookbackMs: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  gate: z.object({
    is_urgent: z.boolean(),
    action: z.enum(["TRIGGER_LLM", "LOG_AND_SLEEP"]),
    confidence: numberSchema,
    reason: z.string(),
    flux_proxy: numberSchema,
    flux_latest: numberSchema,
    flux_mean: numberSchema,
    flux_max: numberSchema,
  }),
  summary: z.object({
    threat_count: z.number().int().nonnegative(),
    actionable_threat_count: z.number().int().nonnegative(),
    top_threat_type: z.string().nullable(),
    top_threat_score: numberSchema,
    top_recommended_action: z.string().nullable(),
  }),
  threats: z.array(threatRowSchema),
});

export const dashboardLatestResponseSchema = z.object({
  timestamp: timestampSchema,
  source: z.enum(["memory", "supabase"]),
  canonicalLatest: canonicalSpaceWeatherPointSchema,
  mmsLatest: mmsReconVectorPointSchema.nullable(),
  auroraLatest: auroraMapResponseSchema.nullable(),
  threatSummary: threatSummaryResponseSchema,
  sourceStatus: z.array(sourceStatusSchema),
  spaceDomain: spaceDomainResponseSchema.optional(),
  vectorOverlay: vectorOverlaySnapshotSchema.optional(),
  freshness: z.object({
    canonicalAgeSeconds: z.number().nullable(),
    mmsAgeSeconds: z.number().nullable(),
    auroraAgeSeconds: z.number().nullable(),
  }),
  auth: z.object({
    role: z.enum(["viewer", "operator", "admin"]).nullable(),
    clearance: clearanceSchema.nullable().optional(),
    userId: z.string().nullable(),
  }),
});

const missionObservationRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["space-weather", "mms-reconnection", "aurora-map"]),
  timestamp: timestampSchema,
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

const missionPassSchema = z.object({
  passId: z.string().min(1),
  target: z.string().min(1),
  station: z.string().min(1),
  aos: timestampSchema,
  los: timestampSchema,
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

export const missionCoreSnapshotResponseSchema = z.object({
  timestamp: timestampSchema,
  source: z.enum(["memory", "supabase"]),
  observation: z.object({
    refs: z.array(missionObservationRefSchema),
    canonicalLatest: canonicalSpaceWeatherPointSchema,
    mmsLatest: mmsReconVectorPointSchema.nullable(),
    auroraLatest: auroraMapResponseSchema.nullable(),
    sourceStatus: z.array(sourceStatusSchema),
    freshness: z.object({
      canonicalAgeSeconds: z.number().nullable(),
      mmsAgeSeconds: z.number().nullable(),
      auroraAgeSeconds: z.number().nullable(),
    }),
  }),
  tracks: z.array(missionTrackSchema),
  threats: z.array(threatRowSchema),
  passes: z.array(missionPassSchema),
  commands: z.array(missionCommandSchema),
  actions: z.object({
    gateAction: z.enum(["TRIGGER_LLM", "LOG_AND_SLEEP"]),
    stormTier: z.enum(["quiet", "watch", "warning", "severe"]),
    primaryAction: z.string(),
  }),
  auth: z.object({
    role: z.enum(["viewer", "operator", "admin"]).nullable(),
    clearance: clearanceSchema.nullable().optional(),
    userId: z.string().nullable(),
  }),
});

export const spaceWeatherFeedResponseSchema = z.object({
  source: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  points: z.array(canonicalSpaceWeatherPointSchema),
});

export const mmsReconnectionFeedResponseSchema = z.object({
  source: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  vectors: z.array(mmsReconVectorPointSchema),
});

function parseWithContract<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  contractName: string,
): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }
  const firstIssue = parsed.error.issues[0];
  const pathLabel =
    firstIssue && firstIssue.path.length > 0 ? firstIssue.path.join(".") : "<root>";
  const message = firstIssue ? firstIssue.message : "unknown contract mismatch";
  throw new Error(`Invalid ${contractName} contract at ${pathLabel}: ${message}`);
}

export function parseSpaceWeatherFeedResponse(payload: unknown) {
  return parseWithContract(spaceWeatherFeedResponseSchema, payload, "space weather feed");
}

export function parseMmsReconnectionFeedResponse(payload: unknown) {
  return parseWithContract(mmsReconnectionFeedResponseSchema, payload, "MMS reconnection feed");
}

export function parseAuroraMapResponse(payload: unknown) {
  return parseWithContract(auroraMapResponseSchema, payload, "aurora map");
}

export function parseSourceStatusResponse(payload: unknown) {
  return parseWithContract(sourceStatusResponseSchema, payload, "source status");
}

export function parseThreatSummaryResponse(payload: unknown) {
  return parseWithContract(threatSummaryResponseSchema, payload, "threat summary");
}

export function parseAuthSessionResponse(payload: unknown) {
  return parseWithContract(authSessionResponseSchema, payload, "auth session");
}

export function parseDashboardLatestResponse(payload: unknown) {
  return parseWithContract(dashboardLatestResponseSchema, payload, "dashboard latest");
}

export function parseSpaceDomainResponse(payload: unknown) {
  return parseWithContract(spaceDomainResponseSchema, payload, "space-domain");
}

export function parseSevenZoneAssessment(payload: unknown) {
  return parseWithContract(sevenZoneAssessmentSchema, payload, "seven-zone assessment");
}

export function parseMissionCoreSnapshotResponse(payload: unknown) {
  return parseWithContract(missionCoreSnapshotResponseSchema, payload, "mission core latest");
}
