import type {
  CanonicalSpaceWeatherPoint,
  DataSource,
  SourceStatus,
} from "../types.js";
import type { RuntimeMemoryPressureLevel } from "../runtime/memory-pressure.js";

export type SourcePowerDecision = "primary" | "validate" | "sample" | "suspend";
type PowerPressure = "low" | "medium" | "high";

export interface SourcePowerPolicy {
  source: DataSource;
  decision: SourcePowerDecision;
  utilityScore: number;
  targetCadenceMs: number | null;
  reason: string;
}

interface ResolveSourcePowerPoliciesInput {
  activeCadenceMsBySource: Record<DataSource, number>;
  latestCanonical: CanonicalSpaceWeatherPoint | null;
  sourceStatus: SourceStatus[];
  powerProfile: "nominal" | "low-power";
  cadenceScale: number;
  airGapped: boolean;
  burstMode: boolean;
  memoryPressure?: RuntimeMemoryPressureLevel;
}

const ORDERED_SOURCES: DataSource[] = [
  "noaa-swpc",
  "esa-hapi",
  "mms-cdaweb",
  "mms-lasp",
  "jaxa-erg",
  "model-nowcast",
];

const BASE_UTILITY: Record<DataSource, number> = {
  "noaa-swpc": 0.96,
  "esa-hapi": 0.73,
  "mms-cdaweb": 0.8,
  "mms-lasp": 0.54,
  "jaxa-erg": 0.36,
  "model-nowcast": 0.5,
};

const SOURCE_POWER_COST: Record<DataSource, number> = {
  "noaa-swpc": 0.02,
  "esa-hapi": 0.08,
  "mms-cdaweb": 0.12,
  "mms-lasp": 0.14,
  "jaxa-erg": 0.16,
  "model-nowcast": 0.08,
};

const STORM_UTILITY_BOOST: Record<
  DataSource,
  Record<CanonicalSpaceWeatherPoint["alerts"]["stormTier"], number>
> = {
  "noaa-swpc": {
    quiet: 0,
    watch: 0.03,
    warning: 0.05,
    severe: 0.08,
  },
  "esa-hapi": {
    quiet: 0.01,
    watch: 0.03,
    warning: 0.06,
    severe: 0.09,
  },
  "mms-cdaweb": {
    quiet: -0.08,
    watch: 0.04,
    warning: 0.15,
    severe: 0.24,
  },
  "mms-lasp": {
    quiet: -0.1,
    watch: 0.03,
    warning: 0.16,
    severe: 0.28,
  },
  "jaxa-erg": {
    quiet: -0.06,
    watch: -0.01,
    warning: 0.04,
    severe: 0.08,
  },
  "model-nowcast": {
    quiet: 0,
    watch: 0,
    warning: 0,
    severe: 0,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseDecision(value: unknown): SourcePowerDecision | null {
  return value === "primary" ||
    value === "validate" ||
    value === "sample" ||
    value === "suspend"
    ? value
    : null;
}

function resolvePowerPressure(input: ResolveSourcePowerPoliciesInput): PowerPressure {
  if (input.airGapped) {
    return "high";
  }
  if (input.memoryPressure === "critical") {
    return "high";
  }
  if (input.powerProfile === "low-power" || input.cadenceScale >= 3) {
    return "high";
  }
  if (input.memoryPressure === "constrained") {
    return input.cadenceScale >= 1.5 ? "high" : "medium";
  }
  if (input.cadenceScale >= 1.5) {
    return "medium";
  }
  return "low";
}

function statusBySource(status: SourceStatus[]): Map<DataSource, SourceStatus> {
  return new Map(
    status.map((entry) => [entry.source, entry] as [DataSource, SourceStatus]),
  );
}

function cadenceMultiplier(decision: SourcePowerDecision): number {
  switch (decision) {
    case "primary":
      return 1;
    case "validate":
      return 2;
    case "sample":
      return 4;
    case "suspend":
      return Number.POSITIVE_INFINITY;
  }
}

function resolveDecision(
  source: DataSource,
  utility: number,
  stormTier: CanonicalSpaceWeatherPoint["alerts"]["stormTier"],
  burstMode: boolean,
  pressure: PowerPressure,
): SourcePowerDecision {
  if (source === "noaa-swpc") {
    if (utility >= 0.72) return "primary";
    return pressure === "high" ? "validate" : "primary";
  }

  if (source === "esa-hapi") {
    if (utility >= 0.76) return "primary";
    if (utility >= 0.46) return "validate";
    return "sample";
  }

  if (source === "mms-cdaweb") {
    if (stormTier === "warning" || stormTier === "severe" || burstMode) {
      if (utility >= 0.66) return "primary";
      return "validate";
    }
    if (utility >= 0.72) return "validate";
    return pressure === "high" ? "sample" : "validate";
  }

  if (source === "mms-lasp") {
    if (burstMode) {
      return utility >= 0.64 ? "primary" : "validate";
    }
    if (stormTier === "warning" || stormTier === "severe") {
      return utility >= 0.56 ? "validate" : "sample";
    }
    if (utility >= 0.62 && pressure !== "high") {
      return "validate";
    }
    return pressure === "high" ? "suspend" : "sample";
  }

  if (source === "jaxa-erg") {
    if (stormTier === "severe" && utility >= 0.48) {
      return "validate";
    }
    if (stormTier === "warning" && utility >= 0.42) {
      return "sample";
    }
    return pressure === "low" && utility >= 0.38 ? "sample" : "suspend";
  }

  if (utility >= 0.72) return "primary";
  if (utility >= 0.48) return "validate";
  if (utility >= 0.3) return "sample";
  return "suspend";
}

export function resolveSourcePowerPolicies(
  input: ResolveSourcePowerPoliciesInput,
): Record<DataSource, SourcePowerPolicy> {
  const pressure = resolvePowerPressure(input);
  const latestStatusBySource = statusBySource(input.sourceStatus);
  const stormTier = input.latestCanonical?.alerts.stormTier ?? "quiet";
  const noaaHealthy = latestStatusBySource.get("noaa-swpc")?.healthy ?? false;

  return ORDERED_SOURCES.reduce<Record<DataSource, SourcePowerPolicy>>((acc, source) => {
    const status = latestStatusBySource.get(source);
    const baseCadenceMs = input.activeCadenceMsBySource[source];

    if (input.airGapped) {
      acc[source] = {
        source,
        decision: "suspend",
        utilityScore: 0,
        targetCadenceMs: null,
        reason: "air-gapped",
      };
      return acc;
    }

    let utility = BASE_UTILITY[source];
    utility += STORM_UTILITY_BOOST[source][stormTier] ?? 0;

    if (input.burstMode && (source === "mms-cdaweb" || source === "mms-lasp")) {
      utility += source === "mms-lasp" ? 0.3 : 0.18;
    }

    if (status?.healthy === false) {
      utility -= source === "noaa-swpc" ? 0.14 : 0.1;
    }

    const latencySeconds = status?.latencySeconds ?? null;
    if (latencySeconds != null && latencySeconds > 1800) {
      utility -= 0.12;
    } else if (latencySeconds != null && latencySeconds > 600) {
      utility -= 0.06;
    }

    if (!noaaHealthy && source === "esa-hapi") {
      utility += 0.18;
    }
    if (!noaaHealthy && source === "mms-cdaweb" && (stormTier === "warning" || stormTier === "severe")) {
      utility += 0.08;
    }

    if (pressure === "medium") {
      utility -= SOURCE_POWER_COST[source] * 0.75;
    } else if (pressure === "high") {
      utility -= SOURCE_POWER_COST[source];
    }

    const observedCostScore =
      typeof status?.observedCostScore === "number" && Number.isFinite(status.observedCostScore)
        ? clamp01(status.observedCostScore)
        : null;
    if (observedCostScore != null) {
      const costPenaltyWeight = pressure === "high" ? 0.24 : pressure === "medium" ? 0.14 : 0.06;
      utility -= observedCostScore * costPenaltyWeight;
      if (observedCostScore <= 0.18 && status?.healthy) {
        utility += 0.03;
      }
    }

    const utilityScore = round(clamp01(utility));
    const overrideDecision = parseDecision(status?.overrideDecision);
    const decision = overrideDecision ?? resolveDecision(source, utilityScore, stormTier, input.burstMode, pressure);
    const overrideCadenceMs =
      typeof status?.overrideTargetCadenceMs === "number" && Number.isFinite(status.overrideTargetCadenceMs)
        ? Math.max(1, Math.round(status.overrideTargetCadenceMs))
        : null;
    const targetCadenceMs =
      decision === "suspend"
        ? null
        : overrideCadenceMs ?? Math.max(baseCadenceMs, Math.round(baseCadenceMs * cadenceMultiplier(decision)));

    acc[source] = {
      source,
      decision,
      utilityScore,
      targetCadenceMs,
      reason: [
        overrideDecision ? `override=${overrideDecision}` : null,
        `storm=${stormTier}`,
        `pressure=${pressure}`,
        `memory=${input.memoryPressure ?? "nominal"}`,
        `healthy=${status?.healthy !== false}`,
        input.burstMode ? "burst=true" : "burst=false",
      ]
        .filter((part): part is string => Boolean(part))
        .join(" "),
    };
    return acc;
  }, {} as Record<DataSource, SourcePowerPolicy>);
}

export function decorateSourceStatusWithPolicies(
  status: SourceStatus[],
  policies: Partial<Record<DataSource, SourcePowerPolicy>>,
): SourceStatus[] {
  return status.map((entry) => {
    const policy = policies[entry.source];
    if (!policy) {
      return entry;
    }
    return {
      ...entry,
      powerDecision: policy.decision,
      utilityScore: policy.utilityScore,
      targetCadenceMs: policy.targetCadenceMs,
      policyReason: policy.reason,
    };
  });
}
