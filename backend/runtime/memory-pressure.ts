import os from "node:os";
import {
  getMemoryCeilingStatus,
  type MemoryCeilingStatus,
} from "../memory-check.js";

export type RuntimeMemoryPressureLevel = "nominal" | "constrained" | "critical";

export interface RuntimeMemoryPressureSnapshot {
  level: RuntimeMemoryPressureLevel;
  signals: string[];
  totalRamGb: number;
  freeRamGb: number;
  usedRamGb: number;
  freeRatio: number;
  thresholds: {
    constrainedFreeMb: number;
    criticalFreeMb: number;
    constrainedFreeRatio: number;
    criticalFreeRatio: number;
  };
  ceiling: MemoryCeilingStatus;
}

type RuntimeMemoryPressureInput = {
  totalMemBytes: number;
  freeMemBytes: number;
  ceiling: MemoryCeilingStatus;
  constrainedFreeMb?: number;
  criticalFreeMb?: number;
  constrainedFreeRatio?: number;
  criticalFreeRatio?: number;
};

const DEFAULT_CONSTRAINED_FREE_MB = 3072;
const DEFAULT_CRITICAL_FREE_MB = 1536;
const DEFAULT_CONSTRAINED_FREE_RATIO = 0.22;
const DEFAULT_CRITICAL_FREE_RATIO = 0.12;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveRuntimeMemoryPressure(
  input: RuntimeMemoryPressureInput,
): RuntimeMemoryPressureSnapshot {
  const totalMemBytes = Math.max(input.totalMemBytes, 1);
  const freeMemBytes = Math.max(0, input.freeMemBytes);
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const freeRatio = freeMemBytes / totalMemBytes;
  const freeMb = freeMemBytes / (1024 * 1024);
  const constrainedFreeMb = input.constrainedFreeMb ?? DEFAULT_CONSTRAINED_FREE_MB;
  const criticalFreeMb = input.criticalFreeMb ?? DEFAULT_CRITICAL_FREE_MB;
  const constrainedFreeRatio = input.constrainedFreeRatio ?? DEFAULT_CONSTRAINED_FREE_RATIO;
  const criticalFreeRatio = input.criticalFreeRatio ?? DEFAULT_CRITICAL_FREE_RATIO;

  const signals: string[] = [];
  let level: RuntimeMemoryPressureLevel = "nominal";

  if (input.ceiling.overCeiling) {
    level = "critical";
    signals.push("ceiling-overrun");
  }
  if (freeMb <= criticalFreeMb) {
    level = "critical";
    signals.push("free-mb-critical");
  } else if (freeMb <= constrainedFreeMb && level !== "critical") {
    level = "constrained";
    signals.push("free-mb-constrained");
  }
  if (freeRatio <= criticalFreeRatio) {
    level = "critical";
    signals.push("free-ratio-critical");
  } else if (freeRatio <= constrainedFreeRatio && level === "nominal") {
    level = "constrained";
    signals.push("free-ratio-constrained");
  }

  if (signals.length === 0) {
    signals.push("headroom-healthy");
  }

  return {
    level,
    signals,
    totalRamGb: round(totalMemBytes / (1024 * 1024 * 1024)),
    freeRamGb: round(freeMemBytes / (1024 * 1024 * 1024)),
    usedRamGb: round(usedMemBytes / (1024 * 1024 * 1024)),
    freeRatio: round(freeRatio),
    thresholds: {
      constrainedFreeMb,
      criticalFreeMb,
      constrainedFreeRatio,
      criticalFreeRatio,
    },
    ceiling: input.ceiling,
  };
}

export function getRuntimeMemoryPressureSnapshot(
  ceilingMb?: number,
): RuntimeMemoryPressureSnapshot {
  return resolveRuntimeMemoryPressure({
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    ceiling: getMemoryCeilingStatus(ceilingMb),
    constrainedFreeMb: readEnvNumber(
      "MEMORY_PRESSURE_CONSTRAINED_FREE_MB",
      DEFAULT_CONSTRAINED_FREE_MB,
    ),
    criticalFreeMb: readEnvNumber(
      "MEMORY_PRESSURE_CRITICAL_FREE_MB",
      DEFAULT_CRITICAL_FREE_MB,
    ),
    constrainedFreeRatio: readEnvNumber(
      "MEMORY_PRESSURE_CONSTRAINED_FREE_RATIO",
      DEFAULT_CONSTRAINED_FREE_RATIO,
    ),
    criticalFreeRatio: readEnvNumber(
      "MEMORY_PRESSURE_CRITICAL_FREE_RATIO",
      DEFAULT_CRITICAL_FREE_RATIO,
    ),
  });
}
