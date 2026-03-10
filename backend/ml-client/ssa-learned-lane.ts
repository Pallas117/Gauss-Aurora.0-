import fs from "node:fs";
import path from "node:path";
import type { SpaceDomainSnapshot } from "../ssa/space-domain-store.js";

const DEFAULT_MODEL_VERSION = "ssa-lane-logreg-v1";
const DEFAULT_REGISTRY_PATH = "ml/models/ssa-registry.json";
const FEATURE_NAMES = [
  "conjunctionCount",
  "maxCollisionProbability",
  "inverseMissDistance",
  "debrisDensity",
  "highValueNeighborDensity",
  "unidentifiedRatio",
  "geoCrowdingScore",
  "meoCrowdingScore",
  "leoCrowdingScore",
  "tleFreshnessScore",
  "conjunctionFreshnessScore",
  "availabilityScore",
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];

export interface SsaDeterministicSummaryInput {
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
}

export interface SsaLearnedLaneFeatures {
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
}

export interface SsaLearnedLaneContribution {
  name: FeatureName;
  weight: number;
  value: number;
  contribution: number;
}

export interface SsaLearnedLaneAssessment {
  modelVersion: string;
  score: number;
  confidence: number;
  trigger: boolean;
  threshold: number;
  blend: number;
  features: SsaLearnedLaneFeatures;
  topContributors: SsaLearnedLaneContribution[];
}

interface SsaModelConfig {
  modelVersion: string;
  intercept: number;
  threshold: number;
  samples: number;
  weights: Record<FeatureName, number>;
}

const BASELINE_MODEL: SsaModelConfig = {
  modelVersion: DEFAULT_MODEL_VERSION,
  intercept: -1.35,
  threshold: 0.68,
  samples: 192,
  weights: {
    conjunctionCount: 0.38,
    maxCollisionProbability: 1.1,
    inverseMissDistance: 0.82,
    debrisDensity: 0.55,
    highValueNeighborDensity: 0.62,
    unidentifiedRatio: 0.3,
    geoCrowdingScore: 0.38,
    meoCrowdingScore: 0.22,
    leoCrowdingScore: 0.12,
    tleFreshnessScore: 0.18,
    conjunctionFreshnessScore: 0.36,
    availabilityScore: 0.28,
  },
};

let modelCache: {
  path: string | null;
  mtimeMs: number;
  value: SsaModelConfig;
} = {
  path: null,
  mtimeMs: -1,
  value: BASELINE_MODEL,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function asFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveRegistryPath(): string {
  const raw = (process.env.SSA_MODEL_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH).trim();
  if (raw.length === 0) {
    return path.resolve(process.cwd(), DEFAULT_REGISTRY_PATH);
  }
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function selectLatestReadySsaModel(models: unknown[]): Record<string, unknown> | null {
  const entries = models
    .map((entry, index) => ({ entry, index }))
    .filter(
      (row): row is { entry: Record<string, unknown>; index: number } =>
        Boolean(row.entry) && typeof row.entry === "object",
    )
    .filter((row) => {
      const status = typeof row.entry.status === "string" ? row.entry.status.toLowerCase() : "ready";
      if (status !== "ready") {
        return false;
      }
      const kind = typeof row.entry.kind === "string" ? row.entry.kind.toLowerCase() : "";
      const version = typeof row.entry.version === "string" ? row.entry.version.toLowerCase() : "";
      return kind === "ssa-lane" || version.includes("ssa-lane");
    });

  if (entries.length === 0) {
    return null;
  }

  entries.sort((a, b) => {
    const aTs = Date.parse(typeof a.entry.trained_at === "string" ? a.entry.trained_at : "");
    const bTs = Date.parse(typeof b.entry.trained_at === "string" ? b.entry.trained_at : "");
    const aTime = Number.isFinite(aTs) ? aTs : -Infinity;
    const bTime = Number.isFinite(bTs) ? bTs : -Infinity;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return b.index - a.index;
  });

  return entries[0]?.entry ?? null;
}

function parseWeights(raw: unknown): Record<FeatureName, number> | null {
  if (Array.isArray(raw) && raw.length >= FEATURE_NAMES.length) {
    const weights = FEATURE_NAMES.reduce((acc, name, index) => {
      const parsed = asFiniteNumber(raw[index]);
      if (parsed == null) {
        return null;
      }
      acc[name] = parsed;
      return acc;
    }, {} as Record<FeatureName, number> | null);
    return weights;
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const weights = {} as Record<FeatureName, number>;
  for (const name of FEATURE_NAMES) {
    const parsed = asFiniteNumber(record[name]);
    if (parsed == null) {
      return null;
    }
    weights[name] = parsed;
  }
  return weights;
}

function loadSsaModelConfig(): SsaModelConfig {
  const registryPath = resolveRegistryPath();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(registryPath);
  } catch {
    modelCache = { path: registryPath, mtimeMs: -1, value: BASELINE_MODEL };
    return BASELINE_MODEL;
  }

  if (modelCache.path === registryPath && modelCache.mtimeMs === stat.mtimeMs) {
    return modelCache.value;
  }

  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as { models?: unknown[] };
    const latest = selectLatestReadySsaModel(Array.isArray(parsed.models) ? parsed.models : []);
    if (!latest) {
      modelCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: BASELINE_MODEL };
      return BASELINE_MODEL;
    }

    const metrics = (latest.metrics ?? {}) as Record<string, unknown>;
    const weights = parseWeights(metrics.weights);
    const intercept = asFiniteNumber(metrics.intercept);
    const threshold = clamp01(asFiniteNumber(metrics.threshold) ?? BASELINE_MODEL.threshold);
    if (!weights || intercept == null) {
      modelCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: BASELINE_MODEL };
      return BASELINE_MODEL;
    }

    const config: SsaModelConfig = {
      modelVersion:
        typeof latest.version === "string" && latest.version.trim().length > 0
          ? latest.version.trim()
          : BASELINE_MODEL.modelVersion,
      intercept,
      threshold,
      samples: Math.max(0, Math.floor(asFiniteNumber(metrics.samples) ?? 0)),
      weights,
    };

    modelCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: config };
    return config;
  } catch {
    modelCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: BASELINE_MODEL };
    return BASELINE_MODEL;
  }
}

function freshnessScore(ageSeconds: number | null, staleAfterSeconds: number): number {
  if (ageSeconds == null) {
    return 0;
  }
  return clamp01(1 - ageSeconds / staleAfterSeconds);
}

function wrappedAngleDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function buildHighValueNeighborDensity(snapshot: SpaceDomainSnapshot): number {
  const highValue = snapshot.satellites?.highValue ?? [];
  const objects = snapshot.satellites?.objects ?? [];
  if (highValue.length === 0 || objects.length <= highValue.length) {
    return 0;
  }

  let totalNeighbors = 0;
  for (const anchor of highValue) {
    const neighbors = objects.filter((candidate) => {
      if (candidate.noradId === anchor.noradId || candidate.orbitType !== anchor.orbitType) {
        return false;
      }
      const longitudeDelta = wrappedAngleDelta(candidate.longitudeDeg, anchor.longitudeDeg);
      const latitudeDelta = Math.abs(candidate.latitudeDeg - anchor.latitudeDeg);
      const altitudeDelta = Math.abs(candidate.altitudeKm - anchor.altitudeKm);
      return longitudeDelta <= 12 && latitudeDelta <= 6 && altitudeDelta <= 1_500;
    }).length;
    totalNeighbors += neighbors;
  }

  return clamp01(totalNeighbors / Math.max(highValue.length * 6, 1));
}

function orbitCrowdingScore(snapshot: SpaceDomainSnapshot, orbitType: "LEO" | "MEO" | "GEO"): number {
  const objects = snapshot.satellites?.objects ?? [];
  if (objects.length === 0) {
    return 0;
  }
  const matching = objects.filter((object) => object.orbitType === orbitType).length;
  return clamp01(matching / Math.max(Math.min(objects.length, 24), 1));
}

export function buildSsaLearnedLaneFeatures(
  snapshot: SpaceDomainSnapshot,
  summary: SsaDeterministicSummaryInput,
): SsaLearnedLaneFeatures {
  const tleFreshnessScore = Math.max(
    freshnessScore(summary.freshness.satellitesAgeSeconds, 6 * 60 * 60),
    freshnessScore(summary.freshness.riskZonesAgeSeconds, 6 * 60 * 60),
  );
  const conjunctionFreshnessScore = freshnessScore(
    summary.freshness.conjunctionsAgeSeconds,
    24 * 60 * 60,
  );
  const availabilityScore = clamp01(
    (summary.availability.riskZones ? 0.25 : 0) +
      (summary.availability.satellites ? 0.35 : 0) +
      (summary.availability.conjunctions ? 0.4 : 0) +
      tleFreshnessScore * 0.15 +
      conjunctionFreshnessScore * 0.1,
  );

  return {
    conjunctionCount: clamp01(1 - Math.exp(-summary.counts.conjunctionCount / 3)),
    maxCollisionProbability: clamp01(
      (summary.conjunctionRisk.maxCollisionProbability ?? 0) / 0.02,
    ),
    inverseMissDistance: clamp01(
      1 - (summary.conjunctionRisk.minMissDistanceM ?? 30_000) / 20_000,
    ),
    debrisDensity: clamp01(Math.log10(summary.crowding.weightedObjectDensity + 1) / 2),
    highValueNeighborDensity: buildHighValueNeighborDensity(snapshot),
    unidentifiedRatio: clamp01(summary.crowding.unidentifiedRatio),
    geoCrowdingScore: clamp01(summary.crowding.geoMaxRiskScore),
    meoCrowdingScore: clamp01(summary.crowding.meoMaxRiskScore),
    leoCrowdingScore: orbitCrowdingScore(snapshot, "LEO"),
    tleFreshnessScore,
    conjunctionFreshnessScore,
    availabilityScore,
  };
}

export function assessSsaLearnedLane(
  snapshot: SpaceDomainSnapshot,
  summary: SsaDeterministicSummaryInput,
): SsaLearnedLaneAssessment {
  const features = buildSsaLearnedLaneFeatures(snapshot, summary);
  const model = loadSsaModelConfig();
  const contributions = FEATURE_NAMES.map((name) => {
    const value = features[name];
    const weight = model.weights[name];
    return {
      name,
      weight,
      value,
      contribution: weight * value,
    } satisfies SsaLearnedLaneContribution;
  });

  const logit =
    model.intercept + contributions.reduce((sum, item) => sum + item.contribution, 0);
  const score = clamp01(logistic(logit));
  const sampleConfidence = clamp01(Math.log10(model.samples + 1) / 3);
  const marginConfidence = clamp01(Math.abs(score - model.threshold) / 0.35);
  const confidence = clamp01(
    features.availabilityScore * 0.4 + sampleConfidence * 0.3 + marginConfidence * 0.3,
  );
  const blend = clamp01(0.12 + sampleConfidence * 0.48);
  const trigger = score >= model.threshold && confidence >= 0.45;

  return {
    modelVersion: model.modelVersion,
    score,
    confidence,
    trigger,
    threshold: model.threshold,
    blend,
    features,
    topContributors: [...contributions]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 4),
  };
}
