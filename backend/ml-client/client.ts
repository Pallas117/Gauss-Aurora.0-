import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { NowcastInferenceRequest, NowcastInferenceResponse } from "../types.js";
import { evaluateInferenceUrgency } from "./probability-gate.js";

const DEFAULT_MODEL_VERSION = "unet-baseline-v1";
const GATE_MODEL_VERSION = "gauss-gate-deterministic-v1";
const DEFAULT_REGISTRY_PATH = "ml/models/registry.json";

interface LearnedNowcastCalibration {
  modelVersion: string;
  perturbMean: number | null;
  auroraMean: number | null;
  blend: number;
}

let calibrationCache: {
  path: string | null;
  mtimeMs: number;
  value: LearnedNowcastCalibration | null;
} = {
  path: null,
  mtimeMs: -1,
  value: null,
};

function isGateEnabled(): boolean {
  const raw = (process.env.GAUSS_PREINFERENCE_GATE_ENABLED ?? "true").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}

function isGateLogEnabled(): boolean {
  const raw = (process.env.GAUSS_PREINFERENCE_GATE_LOG ?? "false").trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function asFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveRegistryPath(): string {
  const raw = (process.env.NOWCAST_MODEL_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH).trim();
  if (raw.length === 0) {
    return path.resolve(process.cwd(), DEFAULT_REGISTRY_PATH);
  }
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function selectLatestReadyModel(models: unknown[]): Record<string, unknown> | null {
  const entries = models
    .map((entry, index) => ({ entry, index }))
    .filter(
      (row): row is { entry: Record<string, unknown>; index: number } =>
        Boolean(row.entry) && typeof row.entry === "object",
    )
    .filter((row) => {
      const status = typeof row.entry.status === "string" ? row.entry.status.toLowerCase() : "ready";
      return status === "ready";
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

function loadLearnedCalibration(): LearnedNowcastCalibration | null {
  const registryPath = resolveRegistryPath();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(registryPath);
  } catch {
    calibrationCache = { path: registryPath, mtimeMs: -1, value: null };
    return null;
  }

  if (
    calibrationCache.path === registryPath &&
    calibrationCache.mtimeMs === stat.mtimeMs
  ) {
    return calibrationCache.value;
  }

  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as { models?: unknown[] };
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    const latest = selectLatestReadyModel(models);
    if (!latest) {
      calibrationCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: null };
      return null;
    }

    const metrics = (latest.metrics ?? {}) as Record<string, unknown>;
    const predictMean = Array.isArray(metrics.predict_mean) ? metrics.predict_mean : [];
    const perturbMean = asFiniteNumber(predictMean[0]);
    const auroraMean = asFiniteNumber(predictMean[1]);
    const samples = Math.max(0, Math.floor(asFiniteNumber(metrics.samples) ?? 0));
    const blend =
      samples > 0 && (perturbMean !== null || auroraMean !== null)
        ? Math.max(0.12, Math.min(0.5, 0.18 + Math.log10(samples + 1) * 0.22))
        : 0;

    const modelVersion =
      typeof latest.version === "string" && latest.version.trim().length > 0
        ? latest.version.trim()
        : DEFAULT_MODEL_VERSION;

    const calibration: LearnedNowcastCalibration = {
      modelVersion,
      perturbMean,
      auroraMean,
      blend,
    };

    calibrationCache = {
      path: registryPath,
      mtimeMs: stat.mtimeMs,
      value: calibration,
    };
    return calibration;
  } catch {
    calibrationCache = { path: registryPath, mtimeMs: stat.mtimeMs, value: null };
    return null;
  }
}

function normalizedSignal(value: unknown): number {
  const num = asFiniteNumber(value);
  return num === null ? 0 : clamp(num, 0, 1);
}

function exogenousContextBias(request: NowcastInferenceRequest): number {
  const earthCore = request.exogenousSignals?.earthCore;
  const solarSystem = request.exogenousSignals?.solarSystem;
  if (!earthCore && !solarSystem) return 0;

  const coreScore =
    0.4 * normalizedSignal(earthCore?.geomagneticJerkIndex) +
    0.35 * normalizedSignal(earthCore?.schumannResonancePower) +
    0.25 * normalizedSignal(earthCore?.coreRotationAnomaly);

  const solarSystemScore =
    0.35 * normalizedSignal(solarSystem?.heliosphereCompression) +
    0.25 * normalizedSignal(solarSystem?.cosmicRayFlux) +
    0.25 * normalizedSignal(solarSystem?.planetaryAlignmentIndex) +
    0.15 * normalizedSignal(solarSystem?.lunarTidalIndex);

  return clamp(coreScore * 0.6 + solarSystemScore * 0.6, -0.8, 0.8);
}

function ragMethodPriorBias(request: NowcastInferenceRequest): number {
  const priors = request.ragMethodPriors;
  if (!Array.isArray(priors) || priors.length === 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const prior of priors) {
    if (!prior || typeof prior !== "object") continue;
    const weight = clamp(asFiniteNumber(prior.weight) ?? 0, -1, 1);
    const confidence = clamp01(asFiniteNumber(prior.confidence) ?? 0.6);
    weighted += weight * confidence;
    total += confidence;
  }

  if (total <= 0) return 0;
  return clamp(weighted / total, -0.6, 0.6);
}

export async function inferNowcast(
  request: NowcastInferenceRequest,
): Promise<NowcastInferenceResponse> {
  if (isGateEnabled()) {
    const gateDecision = evaluateInferenceUrgency(request);
    if (!gateDecision.is_urgent) {
      if (isGateLogEnabled()) {
        console.info(
          `[ml-client] pre-inference gate => ${gateDecision.action} (confidence=${gateDecision.confidence}%, flux=${gateDecision.flux_proxy.toExponential(3)}): ${gateDecision.reason}`,
        );
      }
      return localDeterministicInference(request, GATE_MODEL_VERSION);
    }
  }

  const inferUrl = process.env.LOCAL_INFER_URL;
  if (!inferUrl) {
    return localDeterministicInference(request);
  }

  try {
    const response = await fetch(`${inferUrl}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.warn(
        `[ml-client] inference server returned ${response.status}; falling back to deterministic mode.`,
      );
      return localDeterministicInference(request);
    }

    return (await response.json()) as NowcastInferenceResponse;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[ml-client] inference request failed (${detail}); falling back to deterministic mode.`);
    return localDeterministicInference(request);
  }
}

function localDeterministicInference(
  request: NowcastInferenceRequest,
  modelVersion = DEFAULT_MODEL_VERSION,
): NowcastInferenceResponse {
  const learned = modelVersion === DEFAULT_MODEL_VERSION ? loadLearnedCalibration() : null;
  const contextBias = exogenousContextBias(request);
  const ragBias = ragMethodPriorBias(request);
  const last = request.sequence[request.sequence.length - 1];
  const kpBase = last?.indices.kp ?? 2;
  const bz = last?.magneticField.z ?? 0;
  const speed = last?.solarWind.speed ?? 400;
  const density = last?.solarWind.density ?? 5;
  const coupling = last?.coupling.newell ?? 0;

  const steps = Math.max(1, Math.min(24, Math.floor(request.horizonMinutes / 5)));
  const now = Date.now();
  const predictions = Array.from({ length: steps }, (_, i) => {
    const minutes = (i + 1) * 5;
    const t = new Date(now + minutes * 60 * 1000).toISOString();
    const driver =
      Math.max(0, -bz) * 0.45 +
      (speed - 350) * 0.004 +
      density * 0.05 +
      coupling / 8000 +
      contextBias * 2.2 +
      ragBias * 1.6;
    let geomagneticPerturbation = kpBase * 8 + driver * 12;
    let auroraIntensity = clamp01((kpBase / 9) * 0.7 + driver * 0.03);
    if (learned && learned.blend > 0) {
      if (learned.perturbMean !== null) {
        geomagneticPerturbation =
          geomagneticPerturbation * (1 - learned.blend) + learned.perturbMean * learned.blend;
      }
      if (learned.auroraMean !== null) {
        auroraIntensity = clamp01(
          auroraIntensity * (1 - learned.blend) + learned.auroraMean * learned.blend,
        );
      }
    }
    return {
      timestamp: t,
      geomagneticPerturbation,
      auroraIntensity,
      confidence: Math.max(0.35, Math.min(0.95, 0.9 - i * 0.02)),
    };
  });

  return {
    modelVersion: learned?.modelVersion ?? modelVersion,
    generatedAt: new Date().toISOString(),
    horizonMinutes: request.horizonMinutes,
    predictions,
  };
}

export async function triggerTraining(): Promise<{ started: boolean; pid?: number; message: string }> {
  return new Promise((resolve) => {
    const script = process.env.TRAINING_SCRIPT_PATH ?? "ml/train/train_unet.py";
    const child = spawn("python3", [script], {
      stdio: "ignore",
      detached: true,
    });

    child.on("error", (error) => {
      resolve({ started: false, message: `Failed to start training: ${error.message}` });
    });

    child.unref();
    resolve({ started: true, pid: child.pid, message: "Training started" });
  });
}
