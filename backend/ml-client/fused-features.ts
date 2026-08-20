import type {
  CanonicalSpaceWeatherPoint,
  ExogenousSignalContext,
  MMSReconVectorPoint,
  RagMethodPrior,
} from "../types.js";

export const FUSED_TENSOR_SCHEMA = "gauss-analytics-tensor-v1" as const;
export const FUSED_TENSOR_CADENCE_SECONDS = 5 as const;
export const FUSED_PHYSICS_STEPS = 24 as const;

export const PHYSICS_FEATURE_NAMES = [
  "solar_wind_speed",
  "solar_wind_density",
  "imf_bz",
  "imf_by",
  "imf_bt",
  "electric_ey",
  "dynamic_pressure",
  "newell_coupling",
  "epsilon_coupling",
  "kp_index",
  "dst_index",
  "dst_slope",
  "shue_r0",
  "alfven_speed",
  "sin_clock_angle",
  "cos_clock_angle",
  "l1_delay",
  "storm_tier",
] as const;

export const MMS_FEATURE_NAMES = [
  "current_density",
  "normal_x",
  "normal_y",
  "normal_z",
  "direction_alignment",
  "tetra_volume",
  "tetra_condition",
  "div_curl_ratio",
  "quality_confidence",
  "reconnection_probability",
  "reconnection_confidence",
  "reconnection_lower",
  "reconnection_upper",
  "sample_count",
  "burst_mode",
  "freshness",
  "provenance_measured",
  "provenance_fused",
  "direction_corrected",
  "delta_magnitude",
] as const;

export interface SolarPriorSummary {
  forecastMean?: number;
  forecastMax?: number;
  forecastSlope?: number;
  forecastStd?: number;
  flareProbability24h?: number;
  horizonHours?: number;
  modelFreshnessSeconds?: number;
  available?: boolean;
}

export interface FusedMmsInput {
  current: MMSReconVectorPoint | null;
  previous?: MMSReconVectorPoint | null;
  sampleCount?: number;
  burstMode?: boolean;
  freshnessSeconds?: number;
}

export interface FusedReliabilityInput {
  sourceHealthScore?: number;
  observedIngestCostScore?: number;
  powerConstrained?: boolean;
  airGapOrDegradedMode?: boolean;
}

export interface FusedFeatureInput {
  sequence: CanonicalSpaceWeatherPoint[];
  mms?: FusedMmsInput;
  solar?: SolarPriorSummary;
  exogenous?: ExogenousSignalContext;
  ragMethodPriors?: RagMethodPrior[];
  reliability?: FusedReliabilityInput;
  generatedAt?: string;
}

export interface FusedTensorEnvelope {
  schema: typeof FUSED_TENSOR_SCHEMA;
  generatedAt: string;
  timestamp: string;
  cadenceSeconds: typeof FUSED_TENSOR_CADENCE_SECONDS;
  physics: number[][];
  mms: number[];
  solar: number[];
  exogenous: number[];
  reliability: number[];
  doctrine: number[];
  masks: {
    physics: number[];
    mms: number;
    solar: number;
    exogenous: number;
    doctrine: number;
  };
  provenance: {
    source: "deterministic";
    runtime: "contract-only";
  };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));

const unit = (value: number, scale: number): number => clamp(value / scale, -1, 1);

function bounded(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeClock(value: number): number {
  return clamp(value, -Math.PI, Math.PI);
}

function stormTierOrdinal(point: CanonicalSpaceWeatherPoint): number {
  const tier = point.alerts?.stormTier;
  return ({ quiet: 0, watch: 1, warning: 2, severe: 3 } as const)[tier] ?? 0;
}

function physicsRow(point: CanonicalSpaceWeatherPoint, previous: CanonicalSpaceWeatherPoint | null): number[] {
  const diagnostics = point.diagnostics ?? {};
  const clockAngle = normalizeClock(
    diagnostics.clockAngleRad ?? Math.atan2(point.magneticField?.y ?? 0, point.magneticField?.z ?? 0),
  );
  const previousDst = previous?.indices?.dst ?? point.indices?.dst ?? 0;
  return [
    clamp(bounded(point.solarWind?.speed) / 2000, 0, 1),
    clamp(bounded(point.solarWind?.density) / 1000, 0, 1),
    unit(bounded(point.magneticField?.z), 100),
    unit(bounded(point.magneticField?.y), 100),
    clamp(bounded(point.magneticField?.bt) / 100, 0, 1),
    unit(bounded(point.electricField?.ey), 100),
    clamp(bounded(point.solarWind?.dynamicPressure) / 1000, 0, 1),
    clamp(Math.log1p(Math.max(0, bounded(point.coupling?.newell))) / 12, 0, 1),
    clamp(Math.log1p(Math.max(0, bounded(point.coupling?.epsilon))) / 30, 0, 1),
    clamp(bounded(point.indices?.kp) / 9, 0, 1),
    clamp((bounded(point.indices?.dst) + 400) / 480, 0, 1),
    unit(bounded(point.indices?.dst) - previousDst, 120),
    clamp(bounded(diagnostics.shueR0Re) / 25, 0, 1),
    clamp(bounded(diagnostics.alfvenSpeedKmS) / 5000, 0, 1),
    Math.sin(clockAngle),
    Math.cos(clockAngle),
    clamp(bounded(point.propagation?.l1DelaySeconds) / 6000, 0, 1),
    clamp(stormTierOrdinal(point) / 3, 0, 1),
  ].map((value) => clamp(value, -1, 1));
}

function confidenceScore(value: string | undefined): number {
  return value === "high" ? 1 : value === "medium" ? 0.66 : value === "low" ? 0.33 : 0;
}

function provenanceFlag(mode: MMSReconVectorPoint["provenance"]["mode"] | undefined, expected: "measured" | "fused"): number {
  return mode === expected ? 1 : 0;
}

function mmsVector(input: FusedMmsInput | undefined): number[] {
  const current = input?.current;
  if (!current) return Array.from({ length: 20 }, () => 0);
  const previous = input?.previous ?? null;
  const delta = previous
    ? Math.hypot(
        bounded(current.currentDensity?.x) - bounded(previous.currentDensity?.x),
        bounded(current.currentDensity?.y) - bounded(previous.currentDensity?.y),
        bounded(current.currentDensity?.z) - bounded(previous.currentDensity?.z),
      )
    : 0;
  const probability = current.probability;
  return [
    clamp(bounded(current.currentDensity?.magnitude) / 100, 0, 1),
    unit(bounded(current.normal?.x), 1),
    unit(bounded(current.normal?.y), 1),
    unit(bounded(current.normal?.z), 1),
    unit(bounded(current.directionality?.alignment), 1),
    clamp(bounded(current.quality?.volume), 0, 1),
    clamp(bounded(current.quality?.conditionNumber) / 100, 0, 1),
    clamp(bounded(current.quality?.divCurlRatio) / 10, 0, 1),
    confidenceScore(current.quality?.confidence),
    clamp(bounded(probability?.reconnection), 0, 1),
    clamp(bounded(probability?.confidence), 0, 1),
    clamp(bounded(probability?.lower), 0, 1),
    clamp(bounded(probability?.upper), 0, 1),
    clamp(bounded(input?.sampleCount) / 1000, 0, 1),
    input?.burstMode ? 1 : 0,
    clamp(bounded(input?.freshnessSeconds) / 600, 0, 1),
    provenanceFlag(current.provenance?.mode, "measured"),
    provenanceFlag(current.provenance?.mode, "fused"),
    current.directionality?.corrected ? 1 : 0,
    clamp(delta / 100, 0, 1),
  ].map((value) => clamp(value, -1, 1));
}

function solarVector(input: SolarPriorSummary | undefined): number[] {
  if (!input) return Array.from({ length: 8 }, () => 0);
  return [
    clamp(bounded(input.forecastMean), -1, 1),
    clamp(bounded(input.forecastMax), -1, 1),
    clamp(bounded(input.forecastSlope), -1, 1),
    clamp(bounded(input.forecastStd), 0, 1),
    clamp(bounded(input.flareProbability24h), 0, 1),
    clamp(bounded(input.horizonHours) / 48, 0, 1),
    clamp(bounded(input.modelFreshnessSeconds) / 86_400, 0, 1),
    input.available === false ? 0 : 1,
  ];
}

function exogenousVector(input: ExogenousSignalContext | undefined): number[] {
  const earth = input?.earthCore;
  const solar = input?.solarSystem;
  return [
    clamp(bounded(earth?.geomagneticJerkIndex), 0, 1),
    clamp(bounded(earth?.schumannResonancePower), 0, 1),
    clamp(bounded(earth?.coreRotationAnomaly), 0, 1),
    clamp(bounded(solar?.heliosphereCompression), 0, 1),
    clamp(bounded(solar?.cosmicRayFlux), 0, 1),
    clamp(bounded(solar?.planetaryAlignmentIndex), 0, 1),
    clamp(bounded(solar?.lunarTidalIndex), 0, 1),
    input ? 1 : 0,
  ];
}

function doctrineVector(priors: RagMethodPrior[] | undefined): number[] {
  const safe = (priors ?? []).filter((prior) => prior && typeof prior.id === "string").slice(0, 64);
  if (safe.length === 0) return Array.from({ length: 6 }, () => 0);
  let weighted = 0;
  let confidence = 0;
  let solar = 0;
  let geomagnetic = 0;
  let ops = 0;
  for (const prior of safe) {
    const weight = clamp(bounded(prior.weight), -1, 1);
    const trust = clamp(bounded(prior.confidence, 0.6), 0, 1);
    const contribution = weight * trust;
    weighted += contribution;
    confidence += trust;
    if (prior.domain === "solar") solar += contribution;
    else if (prior.domain === "geomagnetic") geomagnetic += contribution;
    else if (prior.domain === "ops-protocol") ops += contribution;
  }
  const denominator = Math.max(confidence, 1);
  return [
    clamp(weighted / denominator, -1, 1),
    clamp(confidence / safe.length, 0, 1),
    clamp(solar / denominator, -1, 1),
    clamp(geomagnetic / denominator, -1, 1),
    clamp(ops / denominator, -1, 1),
    1,
  ];
}

function reliabilityVector(input: FusedFeatureInput, physicsMask: number[]): number[] {
  const sequence = input.sequence.slice(-FUSED_PHYSICS_STEPS);
  const stale = sequence.filter((point) => point.quality?.stale).length;
  const interpolated = sequence.filter((point) => point.quality?.interpolated).length;
  const extrapolated = sequence.filter((point) => point.quality?.extrapolated).length;
  const lowConfidence = sequence.filter((point) => point.quality?.lowConfidence).length;
  const coverage = physicsMask.reduce((sum, value) => sum + value, 0) / FUSED_PHYSICS_STEPS;
  const staleRatio = sequence.length ? stale / sequence.length : 1;
  const interpolatedRatio = sequence.length ? interpolated / sequence.length : 1;
  const extrapolatedRatio = sequence.length ? extrapolated / sequence.length : 1;
  const lowConfidenceRatio = sequence.length ? lowConfidence / sequence.length : 1;
  const sourceHealth = clamp(
    input.reliability?.sourceHealthScore ?? 1 - Math.max(staleRatio, lowConfidenceRatio),
    0,
    1,
  );
  return [
    coverage,
    1 - staleRatio,
    1 - interpolatedRatio,
    1 - extrapolatedRatio,
    1 - lowConfidenceRatio,
    sourceHealth,
    clamp(input.reliability?.observedIngestCostScore ?? 0, 0, 1),
    input.reliability?.powerConstrained ? 1 : 0,
    input.reliability?.airGapOrDegradedMode ? 1 : 0,
    clamp((sourceHealth + coverage) / 2, 0, 1),
  ];
}

export function buildFusedTensor(input: FusedFeatureInput): FusedTensorEnvelope {
  const sequence = Array.isArray(input.sequence) ? input.sequence.slice(-FUSED_PHYSICS_STEPS) : [];
  const physicsMask = Array.from({ length: FUSED_PHYSICS_STEPS }, () => 0);
  const physics = Array.from({ length: FUSED_PHYSICS_STEPS }, () => Array.from({ length: 18 }, () => 0));
  const offset = FUSED_PHYSICS_STEPS - sequence.length;
  for (let index = 0; index < sequence.length; index += 1) {
    const position = offset + index;
    physics[position] = physicsRow(sequence[index], index > 0 ? sequence[index - 1] : null);
    physicsMask[position] = 1;
  }
  const latest = sequence[sequence.length - 1];
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const mms = mmsVector(input.mms);
  const solar = solarVector(input.solar);
  const exogenous = exogenousVector(input.exogenous);
  const doctrine = doctrineVector(input.ragMethodPriors);
  return {
    schema: FUSED_TENSOR_SCHEMA,
    generatedAt,
    timestamp: latest?.timestamp ?? generatedAt,
    cadenceSeconds: FUSED_TENSOR_CADENCE_SECONDS,
    physics,
    mms,
    solar,
    exogenous,
    reliability: reliabilityVector(input, physicsMask),
    doctrine,
    masks: {
      physics: physicsMask,
      mms: input.mms?.current ? 1 : 0,
      solar: input.solar?.available === false ? 0 : input.solar ? 1 : 0,
      exogenous: input.exogenous ? 1 : 0,
      doctrine: input.ragMethodPriors && input.ragMethodPriors.length > 0 ? 1 : 0,
    },
    provenance: { source: "deterministic", runtime: "contract-only" },
  };
}

export function validateFusedTensor(value: unknown): value is FusedTensorEnvelope {
  if (!value || typeof value !== "object") return false;
  const tensor = value as Partial<FusedTensorEnvelope>;
  return tensor.schema === FUSED_TENSOR_SCHEMA &&
    Array.isArray(tensor.physics) && tensor.physics.length === 24 &&
    tensor.physics.every((row) => Array.isArray(row) && row.length === 18 && row.every(Number.isFinite)) &&
    Array.isArray(tensor.mms) && tensor.mms.length === 20 && tensor.mms.every(Number.isFinite) &&
    Array.isArray(tensor.solar) && tensor.solar.length === 8 && tensor.solar.every(Number.isFinite) &&
    Array.isArray(tensor.exogenous) && tensor.exogenous.length === 8 && tensor.exogenous.every(Number.isFinite) &&
    Array.isArray(tensor.reliability) && tensor.reliability.length === 10 && tensor.reliability.every(Number.isFinite) &&
    Array.isArray(tensor.doctrine) && tensor.doctrine.length === 6 && tensor.doctrine.every(Number.isFinite);
}
