import { getBatteryDrainMultiplier, isBatteryLowAndDischarging } from "./battery";
import { getViteEnv } from "@/lib/heliophysics-utils";
import type { BackendMemoryPressureLevel } from "@/lib/types/space-weather";

type NetworkHints = {
  saveData?: boolean;
  effectiveType?: string;
};

export interface TrendSample {
  timestampMs: number;
  value: number;
}

export interface TrendPollOptions {
  maxSamples?: number;
  minSamples?: number;
  maxMultiplier?: number;
}

export interface TrendPollAnalysis {
  sampleCount: number;
  normalizedError: number;
  normalizedDrift: number;
  projectedValue: number | null;
  stabilityScore: number;
  recommendedMultiplier: number;
}

const DEFAULT_TREND_MAX_SAMPLES = 8;
const DEFAULT_TREND_MIN_SAMPLES = 4;
const DEFAULT_TREND_MAX_MULTIPLIER = 3.5;

function parsePowerProfile(raw: string | undefined): "auto" | "performance" | "balanced" | "low-power" {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "performance" || normalized === "balanced" || normalized === "low-power") {
    return normalized;
  }
  if (normalized === "low" || normalized === "lowpower" || normalized === "power-saver") {
    return "low-power";
  }
  return "auto";
}

function parseEnvMultiplier(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveTrendOptions(options: TrendPollOptions = {}): Required<TrendPollOptions> {
  return {
    maxSamples: Math.max(1, Math.floor(options.maxSamples ?? DEFAULT_TREND_MAX_SAMPLES)),
    minSamples: Math.max(3, Math.floor(options.minSamples ?? DEFAULT_TREND_MIN_SAMPLES)),
    maxMultiplier: Math.max(1, options.maxMultiplier ?? DEFAULT_TREND_MAX_MULTIPLIER),
  };
}

/**
 * Keep a bounded history of scalar observations that can be sampled for validation.
 */
export function appendTrendSample(
  samples: TrendSample[],
  sample: TrendSample,
  options: TrendPollOptions = {},
): TrendSample[] {
  if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.value)) {
    return samples;
  }

  const { maxSamples } = resolveTrendOptions(options);
  const next = [...samples];
  const previous = next[next.length - 1];

  if (previous && previous.timestampMs === sample.timestampMs) {
    next[next.length - 1] = sample;
  } else {
    next.push(sample);
  }

  return next.slice(-maxSamples);
}

/**
 * Fit a tiny linear model to recent samples and use residual error as the validation gate.
 * Stable, low-error trends can be sampled less often; noisy signals snap back to base cadence.
 */
export function analyzeTrendSamples(
  samples: TrendSample[],
  forecastMs: number,
  options: TrendPollOptions = {},
): TrendPollAnalysis {
  const { minSamples, maxMultiplier } = resolveTrendOptions(options);
  const boundedSamples = samples.filter(
    (sample) => Number.isFinite(sample.timestampMs) && Number.isFinite(sample.value),
  );

  if (boundedSamples.length < minSamples) {
    return {
      sampleCount: boundedSamples.length,
      normalizedError: 1,
      normalizedDrift: 1,
      projectedValue: boundedSamples[boundedSamples.length - 1]?.value ?? null,
      stabilityScore: 0,
      recommendedMultiplier: 1,
    };
  }

  const origin = boundedSamples[0]!.timestampMs;
  const xs = boundedSamples.map((sample) => (sample.timestampMs - origin) / 1000);
  const ys = boundedSamples.map((sample) => sample.value);
  const count = boundedSamples.length;
  const sumX = xs.reduce((total, value) => total + value, 0);
  const sumY = ys.reduce((total, value) => total + value, 0);
  const sumXY = xs.reduce((total, value, index) => total + value * ys[index]!, 0);
  const sumXX = xs.reduce((total, value) => total + value * value, 0);
  const denominator = count * sumXX - sumX * sumX;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
    return {
      sampleCount: count,
      normalizedError: 1,
      normalizedDrift: 1,
      projectedValue: ys[ys.length - 1] ?? null,
      stabilityScore: 0,
      recommendedMultiplier: 1,
    };
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const fitted = xs.map((x) => intercept + slope * x);
  const squaredError = fitted.reduce((total, value, index) => {
    const error = ys[index]! - value;
    return total + error * error;
  }, 0);
  const rmse = Math.sqrt(squaredError / count);
  const meanAbs = ys.reduce((total, value) => total + Math.abs(value), 0) / count;
  const minValue = Math.min(...ys);
  const maxValue = Math.max(...ys);
  const scale = Math.max(maxValue - minValue, meanAbs * 0.05, 1);
  const forecastSeconds = Math.max(0, forecastMs) / 1000;
  const lastX = xs[xs.length - 1]!;
  const lastY = ys[ys.length - 1]!;
  const projectedValue = intercept + slope * (lastX + forecastSeconds);
  const projectedDrift = Math.abs(projectedValue - lastY);
  const normalizedError = clamp01(rmse / scale);
  const normalizedDrift = clamp01(projectedDrift / scale);
  const stabilityScore = clamp01(1 - normalizedError * 0.8 - normalizedDrift * 0.2);
  const isStable = normalizedError <= 0.18 && stabilityScore >= 0.5;

  return {
    sampleCount: count,
    normalizedError,
    normalizedDrift,
    projectedValue,
    stabilityScore,
    recommendedMultiplier: isStable ? 1 + stabilityScore * (maxMultiplier - 1) : 1,
  };
}

export function getTrendAwarePollInterval(
  baseMs: number,
  samples: TrendSample[],
  options: TrendPollOptions = {},
): number {
  const analysis = analyzeTrendSamples(samples, baseMs, options);
  return getAdaptivePollInterval(Math.round(baseMs * analysis.recommendedMultiplier));
}

export function getGovernorAwarePollInterval(
  baseMs: number,
  governor?: {
    level?: BackendMemoryPressureLevel;
    nominalMs?: number;
    constrainedMs?: number;
    criticalMs?: number;
    hiddenMs?: number;
  },
): number {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return Math.max(baseMs, governor?.hiddenMs ?? 30_000);
  }

  const level = governor?.level ?? "nominal";
  const resolvedBase =
    level === "critical"
      ? governor?.criticalMs ?? baseMs
      : level === "constrained"
        ? governor?.constrainedMs ?? baseMs
        : governor?.nominalMs ?? baseMs;

  return Math.max(1_000, resolvedBase);
}

/**
 * Resolve adaptive polling interval for battery/network constrained sessions.
 * Enforces 25% rule: when battery is below 25% and not charging, backs off to preserve device (high-value / stakeholder demo).
 */
export function getAdaptivePollInterval(baseMs: number): number {
  const minimumMs = 1000;
  const safeBase = Math.max(baseMs, minimumMs);

  if (typeof window === "undefined" || typeof document === "undefined") {
    return safeBase;
  }

  let multiplier = 1;

  if (document.visibilityState !== "visible") {
    multiplier = Math.max(multiplier, 4);
  }

  const nav = navigator as Navigator & { connection?: NetworkHints };
  const connection = nav.connection;

  if (connection?.saveData) {
    multiplier = Math.max(multiplier, 3);
  }

  if (connection?.effectiveType && /(^2g$)|(^slow-2g$)/i.test(connection.effectiveType)) {
    multiplier = Math.max(multiplier, 4);
  }

  const profile = parsePowerProfile(getViteEnv("VITE_POWER_PROFILE"));
  if (profile === "low-power") {
    multiplier = Math.max(multiplier, 3);
  }

  // 25% rule: never drain device below safe level; back off when battery low and discharging
  if (isBatteryLowAndDischarging()) {
    multiplier = Math.max(multiplier, 3);
  }

  const batteryMultiplier = getBatteryDrainMultiplier();
  if (batteryMultiplier > 1) {
    multiplier = Math.max(multiplier, batteryMultiplier);
  } else if (multiplier === 1) {
    // Only accelerate when no stronger conservation signal is already active.
    multiplier = batteryMultiplier;
  }

  multiplier *= parseEnvMultiplier(getViteEnv("VITE_POLL_INTERVAL_MULTIPLIER"));
  return Math.max(minimumMs, Math.round(safeBase * multiplier));
}
