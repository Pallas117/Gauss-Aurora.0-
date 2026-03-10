export type DataSource =
  | "noaa-swpc"
  | "esa-hapi"
  | "jaxa-erg"
  | "mms-cdaweb"
  | "mms-lasp"
  | "model-nowcast";

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

/** Canonical feed source for threat summary; must match buildThreatSummaryPayload parameter. */
export type CanonicalFeedSource = "memory" | "supabase" | "influxdb";

export interface CanonicalSpaceWeatherPoint {
  timestamp: string;
  source: DataSource | "fusion";
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

export interface MMSTetrahedronQuality {
  valid: boolean;
  volume: number;
  conditionNumber: number;
  divCurlRatio: number;
  confidence: "high" | "medium" | "low";
  reason?: string;
}

export interface MMSReconnectionProbability {
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
}

export interface MMSDirectionality {
  corrected: boolean;
  alignment: number;
  referenceVector: "electric-field" | "magnetic-field" | "history";
  reason: string;
}

export interface MMSVectorProvenance {
  mode: "measured" | "predicted" | "fused";
  sampleCount: number;
  burstMode: boolean;
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
  quality: MMSTetrahedronQuality;
  probability?: MMSReconnectionProbability;
  directionality?: MMSDirectionality;
  provenance?: MMSVectorProvenance;
}

export interface AuroraGridPoint {
  lat: number;
  lon: number;
  probability: number;
  energyFlux: number;
}

export interface SphericalHarmonicCoefficients {
  lMax: number;
  coefficients: Array<{ l: number; m: number; re: number; im: number }>;
  powerSpectrum: Array<{ l: number; cL: number }>;
}

export interface SourceStatus {
  source: DataSource;
  lastSeen: string | null;
  latencySeconds: number | null;
  healthy: boolean;
  message?: string;
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

/** Risk zone from open-catalog for threat pipeline (optional merge into debris). */
export interface RiskZoneInput {
  orbitType: "MEO" | "GEO";
  altitudeKm: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  riskScore: number;
  objectCount?: number;
}

/** Optional exogenous signals for multi-source correlation beyond space-weather feed. */
export interface ExogenousSignalContext {
  earthCore?: {
    /** Normalized [0,1] geomagnetic jerk intensity proxy. */
    geomagneticJerkIndex?: number;
    /** Normalized [0,1] Schumann resonance power proxy. */
    schumannResonancePower?: number;
    /** Normalized [0,1] core rotation anomaly proxy. */
    coreRotationAnomaly?: number;
  };
  solarSystem?: {
    /** Normalized [0,1] heliosphere compression proxy. */
    heliosphereCompression?: number;
    /** Normalized [0,1] cosmic ray flux proxy. */
    cosmicRayFlux?: number;
    /** Normalized [0,1] planetary alignment stress proxy. */
    planetaryAlignmentIndex?: number;
    /** Normalized [0,1] lunar tidal proxy. */
    lunarTidalIndex?: number;
  };
}

/** Retrieval-derived priors from operator documents / RAG method library. */
export interface RagMethodPrior {
  id: string;
  /** Signed influence in [-1, 1]. Positive increases forecast risk/intensity. */
  weight: number;
  /** Optional confidence in [0,1]. Defaults to 0.6 when omitted. */
  confidence?: number;
  /** Optional taxonomy tag, e.g. "solar", "geomagnetic", "ssa", "ops-protocol". */
  domain?: string;
}

export interface NowcastInferenceRequest {
  horizonMinutes: number;
  sequence: CanonicalSpaceWeatherPoint[];
  /** Optional risk zones from GET /api/ssa/risk-zones; merged into debris threat context. */
  riskZones?: RiskZoneInput[];
  /** Optional multi-source context for exogenous coupling effects. */
  exogenousSignals?: ExogenousSignalContext;
  /** Optional RAG priors from retrieved methods or operator doctrine. */
  ragMethodPriors?: RagMethodPrior[];
}

export interface NowcastInferenceResponse {
  modelVersion: string;
  generatedAt: string;
  horizonMinutes: number;
  predictions: Array<{
    timestamp: string;
    geomagneticPerturbation: number;
    auroraIntensity: number;
    confidence: number;
  }>;
}

export interface IngestionTickResult {
  canonicalPoint: CanonicalSpaceWeatherPoint | null;
  mmsVector: MMSReconVectorPoint | null;
  sourceStatus: SourceStatus[];
  auroraMap: {
    timestamp: string;
    nside: number;
    grid: AuroraGridPoint[];
    harmonics: SphericalHarmonicCoefficients;
  } | null;
}

export interface TelemetryPacketIngestRecord {
  timestamp: string;
  apid: number;
  seq_count: number;
  payload_hex: string;
  canonical_point: CanonicalSpaceWeatherPoint;
  quality_flags: {
    crc_checked: boolean;
    crc_valid?: boolean | null;
    missing_parameters: boolean;
  };
  uncertainty: Record<string, unknown>;
}

export interface PacketDecoderStatus {
  enabled: boolean;
  dictionary_id: string | null;
  last_decode_at: string | null;
  decode_error_rate_5m: number;
  last_error: string | null;
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

export interface MissionCoreSnapshot {
  timestamp: string;
  source: "memory" | "supabase";
  observation: {
    refs: MissionObservationRef[];
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    auroraLatest: {
      timestamp: string;
      nside: number;
      grid: AuroraGridPoint[];
      harmonics: SphericalHarmonicCoefficients;
    } | null;
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
    clearance: "public" | "mission" | "restricted" | null;
    userId: string | null;
  };
}
