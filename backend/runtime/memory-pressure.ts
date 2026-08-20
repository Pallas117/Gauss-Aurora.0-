import os from "node:os";
import {
  getMemoryCeilingStatus,
  type MemoryCeilingStatus,
} from "../memory-check.js";

export type RuntimeMemoryPressureLevel = "nominal" | "constrained" | "critical";

export interface MemoryGovernorHealth {
  level: RuntimeMemoryPressureLevel;
  freeMb: number;
  suspendedSubsystems: string[];
  svgLiteForced: boolean;
}

export interface RuntimeMemoryPressureSnapshot extends MemoryGovernorHealth {
  signals: string[];
  totalRamGb: number;
  freeRamGb: number;
  usedRamGb: number;
  freeRatio: number;
  thresholds: {
    nominalMinFreeMb: number;
    criticalMaxFreeMb: number;
  };
  publicPollMs: number;
  protectedPollMs: number;
  hiddenPollMs: number;
  ceiling: MemoryCeilingStatus;
}

type RuntimeMemoryPressureInput = {
  totalMemBytes: number;
  freeMemBytes: number;
  ceiling: MemoryCeilingStatus;
  nominalMinFreeMb?: number;
  criticalMaxFreeMb?: number;
};

const DEFAULT_NOMINAL_MIN_FREE_MB = 1500;
const DEFAULT_CRITICAL_MAX_FREE_MB = 500;
const PUBLIC_POLL_MS = {
  nominal: 5_000,
  constrained: 15_000,
  critical: 30_000,
} as const;
const PROTECTED_POLL_MS = {
  nominal: 10_000,
  constrained: 20_000,
  critical: 30_000,
} as const;
const HIDDEN_POLL_MS = 30_000;

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
  const nominalMinFreeMb = input.nominalMinFreeMb ?? DEFAULT_NOMINAL_MIN_FREE_MB;
  const criticalMaxFreeMb = input.criticalMaxFreeMb ?? DEFAULT_CRITICAL_MAX_FREE_MB;

  const signals: string[] = [];
  let level: RuntimeMemoryPressureLevel = "nominal";

  if (input.ceiling.overCeiling) {
    level = "critical";
    signals.push("ceiling-overrun");
  }

  if (freeMb < criticalMaxFreeMb) {
    level = "critical";
    signals.push("free-mb-critical");
  } else if (freeMb <= nominalMinFreeMb && level !== "critical") {
    level = "constrained";
    signals.push("free-mb-constrained");
  }

  if (signals.length === 0) {
    signals.push("headroom-healthy");
  }

  const suspendedSubsystems =
    level === "nominal"
      ? []
      : level === "constrained"
        ? [
            "rag-refresh",
            "optional-enrichers",
            "startup-chat-check",
          ]
        : [
            "rag-refresh",
            "optional-enrichers",
            "startup-chat-check",
            "background-reconcile",
            "projection-refresh",
          ];

  return {
    level,
    freeMb: round(freeMb),
    suspendedSubsystems,
    svgLiteForced: level !== "nominal",
    signals,
    totalRamGb: round(totalMemBytes / (1024 * 1024 * 1024)),
    freeRamGb: round(freeMemBytes / (1024 * 1024 * 1024)),
    usedRamGb: round(usedMemBytes / (1024 * 1024 * 1024)),
    freeRatio: round(freeRatio),
    thresholds: {
      nominalMinFreeMb,
      criticalMaxFreeMb,
    },
    publicPollMs: PUBLIC_POLL_MS[level],
    protectedPollMs: PROTECTED_POLL_MS[level],
    hiddenPollMs: HIDDEN_POLL_MS,
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
    nominalMinFreeMb: readEnvNumber(
      "MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB",
      DEFAULT_NOMINAL_MIN_FREE_MB,
    ),
    criticalMaxFreeMb: readEnvNumber(
      "MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB",
      DEFAULT_CRITICAL_MAX_FREE_MB,
    ),
  });
}

export function toMemoryGovernorHealth(
  snapshot: RuntimeMemoryPressureSnapshot,
): MemoryGovernorHealth {
  return {
    level: snapshot.level,
    freeMb: snapshot.freeMb,
    suspendedSubsystems: snapshot.suspendedSubsystems,
    svgLiteForced: snapshot.svgLiteForced,
  };
}
