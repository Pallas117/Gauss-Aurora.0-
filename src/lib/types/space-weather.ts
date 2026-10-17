export interface QualityFlags {
  outlier: boolean;
  stale: boolean;
  interpolated: boolean;
  extrapolated: boolean;
  lowConfidence: boolean;
}

export interface UncertaintyEnvelope {
  lower: number;
  upper: number;
  sigma: number;
}

export interface CanonicalSpaceWeatherPoint {
  timestamp: string;
  source: string;
  rho: number;
  velocity: {
    x: number;
    y: number;
    z: number;
    magnitude: number;
  };
  magneticField: {
    x: number;
    y: number;
    z: number;
    bt: number;
  };
  electricField: {
    x: number;
    y: number;
    z: number;
    ey: number;
  };
  solarWind: {
    speed: number;
    density: number;
    dynamicPressure: number;
  };
  indices: {
    kp: number;
    dst: number;
  };
  coupling: {
    newell: number;
    epsilon: number;
  };
  propagation: {
    l1DelaySeconds: number;
    etaEarthArrival: string;
  };
  alerts: {
    stormTier: "quiet" | "watch" | "warning" | "severe";
    reason: string;
  };
  quality: QualityFlags;
  uncertainty: {
    speed: UncertaintyEnvelope;
    density: UncertaintyEnvelope;
    bz: UncertaintyEnvelope;
  };
  diagnostics?: {
    shueR0Re?: number;
    alfvenSpeedKmS?: number;
    clockAngleRad?: number;
  };
}

export interface MMSReconVectorPoint {
  timestamp: string;
  barycenterGsmRe: {
    x: number;
    y: number;
    z: number;
  };
  currentDensity: {
    x: number;
    y: number;
    z: number;
    magnitude: number;
  };
  normal: {
    x: number;
    y: number;
    z: number;
  };
  lmn: {
    l: { x: number; y: number; z: number };
    m: { x: number; y: number; z: number };
    n: { x: number; y: number; z: number };
  };
  quality: {
    valid: boolean;
    volume: number;
    conditionNumber: number;
    divCurlRatio: number;
    confidence: "high" | "medium" | "low";
    reason?: string;
  };
  probability?: {
    reconnection: number;
    confidence: number;
    lower: number;
    upper: number;
    driver: "measured" | "predicted" | "fused";
    factors: {
      southwardImf: number;
      electricDriver: number;
      coupling: number;
      tetraQuality: number;
      sampleCoverage: number;
      burstBoost: number;
      freshnessPenalty: number;
    };
  };
  directionality?: {
    corrected: boolean;
    alignment: number;
    referenceVector: "electric-field" | "magnetic-field" | "history";
    reason: string;
  };
  provenance?: {
    mode: "measured" | "predicted" | "fused";
    sampleCount: number;
    burstMode: boolean;
  };
}

export interface AuroraGridPoint {
  lat: number;
  lon: number;
  probability: number;
  energyFlux: number;
}

export interface AuroraMapResponse {
  timestamp: string;
  nside: number;
  grid: AuroraGridPoint[];
  harmonics: {
    lMax: number;
    coefficients: Array<{ l: number; m: number; re: number; im: number }>;
    powerSpectrum: Array<{ l: number; cL: number }>;
  };
}

export interface SourceStatus {
  source: string;
  lastSeen: string | null;
  latencySeconds: number | null;
  healthy: boolean;
  message?: string;
  /** "unknown" marks a reachability probe: neither healthy nor degraded. */
  truthState?: "observed" | "unknown";
  powerDecision?: "primary" | "validate" | "sample" | "suspend";
  utilityScore?: number;
  targetCadenceMs?: number | null;
  policyReason?: string;
  observedCostScore?: number;
  avgFetchDurationMs?: number;
  avgCpuMs?: number;
  avgPayloadKb?: number;
  sampleCount?: number;
  overrideDecision?: "primary" | "validate" | "sample" | "suspend" | null;
  overrideTargetCadenceMs?: number | null;
  overrideReason?: string | null;
  overrideUpdatedAt?: string | null;
  overrideUpdatedBy?: string | null;
}

export type AuthClearance = "public" | "mission" | "restricted";

export interface VectorDirection {
  x: number;
  y: number;
  z: number;
  magnitude: number;
}

export interface VectorOverlaySnapshot {
  timestamp: string;
  referenceFrame: "GSM";
  solarWindDirection: VectorDirection;
  electricFieldDirection: VectorDirection;
  imfDirection: VectorDirection;
  cmeProxy: {
    direction: VectorDirection;
    coneWidthDeg: number;
    confidence: number;
    driver: string;
  };
  mms: {
    normalDirection: VectorDirection;
    currentDirection: VectorDirection;
    quality: "high" | "medium" | "low";
    provenance: "measured" | "predicted" | "fused";
  } | null;
  riskVector: {
    recommendedAction: string;
    type: string;
    compositeScore: number;
    actionable: boolean;
  };
}

export interface ThreatFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  unit?: string;
}

export interface ThreatSummaryRow {
  id: string;
  type: "collision" | "solar_flare" | "cyber" | "debris" | "radiation" | "anomaly";
  probability: number;
  confidence_interval: [number, number];
  factors: ThreatFactor[];
  composite_score: number;
  actionable: boolean;
  recommended_action: string;
}

export interface ThreatSummaryResponse {
  timestamp: string;
  source: string;
  lookbackMs: number;
  count: number;
  gate: {
    is_urgent: boolean;
    action: "TRIGGER_LLM" | "LOG_AND_SLEEP";
    confidence: number;
    reason: string;
    flux_proxy: number;
    flux_latest: number;
    flux_mean: number;
    flux_max: number;
  };
  summary: {
    threat_count: number;
    actionable_threat_count: number;
    top_threat_type: string | null;
    top_threat_score: number;
    top_recommended_action: string | null;
  };
  threats: ThreatSummaryRow[];
}

/** Session-driven feature flags (heliophysics ops + debris), set by role or staff-by-email. */
export interface SessionFeatures {
  heliophysics: boolean;
  debris: boolean;
}

export interface AuthSessionState {
  authRequired: boolean;
  authenticated: boolean;
  role: "viewer" | "operator" | "admin" | null;
  clearance: AuthClearance | null;
  userId: string | null;
  email: string | null;
  emailVerified?: boolean;
  /** Set by backend from role or STAFF_EMAIL_DOMAINS / STAFF_EMAILS */
  features?: SessionFeatures;
  message?: string;
  error?: string;
}

export interface DashboardLatestResponse {
  timestamp: string;
  source: "memory" | "supabase";
  canonicalLatest: CanonicalSpaceWeatherPoint;
  mmsLatest: MMSReconVectorPoint | null;
  auroraLatest: AuroraMapResponse | null;
  threatSummary: ThreatSummaryResponse;
  sourceStatus: SourceStatus[];
  spaceDomain?: SpaceDomainResponse;
  vectorOverlay?: VectorOverlaySnapshot;
  freshness: {
    canonicalAgeSeconds: number | null;
    mmsAgeSeconds: number | null;
    auroraAgeSeconds: number | null;
  };
  auth: {
    role: "viewer" | "operator" | "admin" | null;
    clearance: AuthClearance | null;
    userId: string | null;
  };
}

export interface RiskZoneSnapshotResponse {
  riskZones: Array<{
    orbitType: "MEO" | "GEO";
    altitudeKm: number;
    latitudeDeg?: number;
    longitudeDeg?: number;
    riskScore: number;
    objectCount?: number;
  }>;
  updatedAt: string;
}

export interface SatelliteObject {
  noradId: string;
  name: string;
  orbitType: "LEO" | "MEO" | "GEO";
  altitudeKm: number;
  latitudeDeg: number;
  longitudeDeg: number;
  highValue: boolean;
  unidentified: boolean;
}

export interface SatelliteObjectsSnapshotResponse {
  objects: SatelliteObject[];
  highValue: SatelliteObject[];
  unidentified: SatelliteObject[];
  updatedAt: string;
}

export interface SpaceDomainSummary {
  updatedAt: string | null;
  freshness: {
    riskZonesAgeSeconds: number | null;
    satellitesAgeSeconds: number | null;
    conjunctionsAgeSeconds: number | null;
  };
  availability: {
    riskZones: boolean;
    satellites: boolean;
    conjunctions: boolean;
  };
  counts: {
    riskZoneCount: number;
    satelliteObjectCount: number;
    highValueCount: number;
    unidentifiedCount: number;
    conjunctionCount: number;
  };
  crowding: {
    maxRiskScore: number;
    avgRiskScore: number;
    geoMaxRiskScore: number;
    meoMaxRiskScore: number;
    weightedObjectDensity: number;
    unidentifiedRatio: number;
  };
  conjunctionRisk: {
    maxCollisionProbability: number | null;
    minMissDistanceM: number | null;
    recentCriticalCount: number;
  };
  learnedLane: {
    modelVersion: string;
    score: number;
    confidence: number;
    trigger: boolean;
    threshold: number;
    blend: number;
    features: {
      conjunctionCount: number;
      maxCollisionProbability: number;
      inverseMissDistance: number;
      debrisDensity: number;
      highValueNeighborDensity: number;
      unidentifiedRatio: number;
      geoCrowdingScore: number;
      meoCrowdingScore: number;
      leoCrowdingScore: number;
      tleFreshnessScore: number;
      conjunctionFreshnessScore: number;
      availabilityScore: number;
    };
    topContributors: Array<{
      name: string;
      weight: number;
      value: number;
      contribution: number;
    }>;
  };
}

export interface SpaceDomainAvailability {
  mode: "live" | "projected" | "warming";
  lastLiveAt: string | null;
  dataAgeSeconds: number | null;
  reason: "ok" | "ingest_empty" | "ingest_stale" | "memory_suppressed";
  projectionMethod: "sgp4" | "hold" | null;
}

export interface SpaceDomainAnalysis {
  generatedAt: string;
  cadenceSeconds: number;
  source: "deterministic" | "hybrid";
  severity: "quiet" | "watch" | "warning" | "critical";
  headline: string;
  summary: string;
  confidence: number;
  changed: boolean;
  changedSignals: string[];
  metrics: {
    learnedLaneScore: number;
    maxRiskScore: number;
    maxCollisionProbability: number | null;
    minMissDistanceM: number | null;
    conjunctionCount: number;
  };
  model: {
    used: boolean;
    modelId: string | null;
    generatedAt: string | null;
  };
}

export interface PublicSpaceDomainSnapshot {
  updatedAt: string | null;
  riskZones: RiskZoneSnapshotResponse | null;
  satellites: SatelliteObjectsSnapshotResponse | null;
  conjunctions: {
    updatedAt: string | null;
    count: number;
  };
}

export interface SpaceDomainResponse {
  snapshot: PublicSpaceDomainSnapshot;
  availability: SpaceDomainAvailability;
  summary: SpaceDomainSummary;
  analysis: SpaceDomainAnalysis;
}

export type MissionObservationKind =
  | "space-weather"
  | "mms-reconnection"
  | "aurora-map";

export interface MissionObservationRef {
  id: string;
  kind: MissionObservationKind;
  timestamp: string;
  source: string;
  confidence: number;
  stale: boolean;
}

export interface MissionTrack {
  id: string;
  type: "space-weather-driver" | "reconnection-front";
  state: "confirmed" | "predicted" | "stale";
  confidence: number;
  observationIds: string[];
  summary: string;
}

export interface MissionPassWindow {
  passId: string;
  target: string;
  station: string;
  aos: string;
  los: string;
  status: "planned" | "scheduled" | "active" | "completed";
  mode: "placeholder" | "external";
  priority: number;
}

export interface MissionCommandIntent {
  commandId: string;
  commandType: "trigger-nowcast" | "schedule-pass" | "log-health-check";
  status: "proposed" | "ready" | "blocked";
  requiresRole: "viewer" | "operator" | "admin";
  reason: string;
}

export interface MissionCoreSnapshotResponse {
  timestamp: string;
  source: "memory" | "supabase";
  observation: {
    refs: MissionObservationRef[];
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    auroraLatest: AuroraMapResponse | null;
    sourceStatus: SourceStatus[];
    freshness: {
      canonicalAgeSeconds: number | null;
      mmsAgeSeconds: number | null;
      auroraAgeSeconds: number | null;
    };
  };
  tracks: MissionTrack[];
  threats: Array<{
    id: string;
    type: string;
    probability: number;
    confidence_interval: [number, number];
    composite_score: number;
    actionable: boolean;
    recommended_action: string;
  }>;
  passes: MissionPassWindow[];
  commands: MissionCommandIntent[];
  actions: {
    gateAction: "TRIGGER_LLM" | "LOG_AND_SLEEP";
    stormTier: "quiet" | "watch" | "warning" | "severe";
    primaryAction: string;
  };
  auth: {
    role: "viewer" | "operator" | "admin" | null;
    clearance: AuthClearance | null;
    userId: string | null;
  };
}

export interface FeedbackSubmissionRequest {
  category: "bug" | "feature" | "operations" | "security" | "billing";
  sentiment: "positive" | "neutral" | "negative";
  message: string;
  contactEmail?: string | null;
  rating?: number | null;
  page?: string | null;
}

export interface FeedbackSubmissionResponse {
  ok: boolean;
  id: string;
  submittedAt: string;
}

export interface OpsCommandStatusChip {
  id: string;
  label: string;
  tone: "ok" | "warn" | "critical" | "info";
  value?: string;
}

export type DtnIslControlStatus = "pass" | "warn" | "fail";

export interface DtnIslAuditControl {
  id: string;
  title: string;
  status: DtnIslControlStatus;
  details: string;
}

export interface DtnIslAuditStatus {
  configured: boolean;
  reachable: boolean;
  generated_at: string | null;
  readiness_score: number;
  pass: number;
  warn: number;
  fail: number;
  controls: DtnIslAuditControl[];
  last_error: string | null;
}

export type WorkerId =
  | "telemetry-ingest"
  | "ssa-analysis"
  | "source-policy"
  | "command-planner"
  | "safe-executor"
  | "service-reanimator"
  | "offline-repair"
  | "event-deposit";

export type WorkerLane = "runtime" | "offline";
export type WorkerApprovalMode = "none" | "safe-auto" | "operator-gate";
export type WorkerActionClass = "observe" | "housekeeping" | "mission";
export type WorkerTaskKind =
  | "telemetry-refresh"
  | "ssa-review"
  | "source-adjustment"
  | "command-request"
  | "service-outage"
  | "repair-batch"
  | "event-lesson";
export type WorkerTaskPriority = "low" | "medium" | "high";
export type WorkerTaskSource =
  | "runtime"
  | "command-ui"
  | "automation"
  | "picoclaw"
  | "offline-capsule";

export interface WorkerTaskEnvelope {
  id: string;
  createdAt: string;
  lane: WorkerLane;
  kind: WorkerTaskKind;
  priority: WorkerTaskPriority;
  source: WorkerTaskSource;
  actor: {
    userId: string | null;
    role: "viewer" | "operator" | "admin" | null;
  };
  memory: {
    level: BackendMemoryPressureLevel;
  };
  payload: Record<string, unknown>;
  relatedArtifacts: string[];
  requestedWorkerId?: WorkerId | null;
  parentTaskId?: string | null;
}

export interface WorkerResult {
  workerId: WorkerId;
  status: "completed" | "deferred" | "blocked" | "failed";
  summary: string;
  autoExecuted: boolean;
  queuedApproval: boolean;
  touchedSystems: string[];
  nextTasks: Array<{
    workerId: WorkerId;
    reason: string;
  }>;
  artifacts: string[];
  metrics?: Record<string, number>;
}

export interface WorkerStatusSnapshot {
  id: WorkerId;
  lane: WorkerLane;
  enabled: boolean;
  approval: WorkerApprovalMode;
  state: "idle" | "running" | "degraded" | "suspended";
  lastRunAt: string | null;
  lastResult: WorkerResult | null;
}

export interface QueuedWorkerApproval {
  taskId: string;
  workerId: WorkerId;
  summary: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
}

export interface OpsDelegationQueueResponse {
  pendingTasks: Array<{
    taskId: string;
    workerId: WorkerId;
    summary: string;
    state: "queued" | "running";
    createdAt: string;
  }>;
  queuedApprovals: QueuedWorkerApproval[];
  brokerPolicy?: {
    memoryLevel: BackendMemoryPressureLevel;
    autoSafeOps: true;
  };
}

export interface OpsDelegationApprovalRequest {
  taskId: string;
}

export interface OpsCommandSnapshotResponse {
  updatedAt: string;
  session: AuthSessionState;
  sourceStatus: SourceStatus[];
  canonicalLatest: CanonicalSpaceWeatherPoint;
  mmsLatest: MMSReconVectorPoint | null;
  auroraLatest: AuroraMapResponse | null;
  threatSummary: ThreatSummaryResponse;
  dtnIslStatus: DtnIslAuditStatus;
  cybertigerStatus: {
    enabled: boolean;
    counters?: {
      totalInspected?: number;
      blocked?: number;
      signatureHits?: number;
      rateLimited?: number;
      authFailures?: number;
      activeBlocks?: number;
      storedEvents?: number;
    };
    activeBlocks?: Array<{
      ip: string;
      until: string;
      reason: string;
    }>;
  } | null;
  statusChips?: OpsCommandStatusChip[];
  workers: WorkerStatusSnapshot[];
  queuedApprovals: QueuedWorkerApproval[];
  brokerPolicy: {
    memoryLevel: BackendMemoryPressureLevel;
    autoSafeOps: true;
    plannerMode?: string;
  };
}

export type OpsCommandType = "trigger-nowcast" | "schedule-pass" | "log-health-check";
export type OpsCommandJobStatus = "planned" | "running" | "succeeded" | "failed";

export interface OpsCommandPlan {
  command_type: OpsCommandType;
  payload: Record<string, unknown>;
  reason: string | null;
  confidence: number | null;
}

export interface OpsCommandJob {
  jobId: string;
  commandType: OpsCommandType;
  payload: Record<string, unknown>;
  source: "manual" | "external-model";
  status: OpsCommandJobStatus;
  simulate: boolean;
  idempotencyKey: string | null;
  requestedBy: string | null;
  powerConstrained: boolean;
  heavyCommand: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface OpsCommandQueueResponse {
  log: Record<string, unknown>;
  job: OpsCommandJob;
  deduped: boolean;
  planner?: {
    power?: Record<string, unknown>;
    profile?: Record<string, unknown>;
  };
}

export interface ModelPlannerResponse {
  command: OpsCommandPlan;
  log: Record<string, unknown>;
  job?: OpsCommandJob;
  deduped?: boolean;
  planner?: {
    power?: Record<string, unknown>;
    profile?: Record<string, unknown>;
  };
}

export interface OpsCommandMetricsResponse {
  metrics: Record<string, number | string>;
  planner_circuit: {
    open: boolean;
    open_until: string | null;
    consecutive_failures: number;
  };
}

export type SafeCommandRisk = "low" | "medium" | "high";

export interface SafeCommandPlan {
  executable: string;
  args: string[];
  reason: string | null;
  confidence: number | null;
  risk: SafeCommandRisk;
}

export interface SafeCommandProposal {
  proposalId: string;
  requestedBy: string | null;
  promptDigest: string;
  createdAt: string;
  expiresAt: string;
  commandPreview: string;
  plan: SafeCommandPlan;
}

export interface ModelSafeCommandPlanResponse {
  proposal: SafeCommandProposal;
  approval: {
    token: string;
    expires_at: string;
  } | null;
  allowlist: string[];
  log: Record<string, unknown>;
}

export interface ModelSafeCommandExecuteResponse {
  proposal: SafeCommandProposal;
  execution: {
    ok: boolean;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    truncated: boolean;
    commandPreview: string;
  };
  log: Record<string, unknown>;
}

export type BackendMemoryPressureLevel = "nominal" | "constrained" | "critical";


export interface BackendMemoryHealth {
  level: BackendMemoryPressureLevel;
  freeMb: number;
  suspendedSubsystems: string[];
  svgLiteForced: boolean;
  plannerMode?: string;
}

export interface BackendHealthResponse {
  ok: boolean;
  timestamp: string;
  memory: BackendMemoryHealth;
}
