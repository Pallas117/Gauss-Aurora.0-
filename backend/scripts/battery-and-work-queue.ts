/**
 * Shared battery and work-queue reading for orchestrate-tests and full-adherence-audit.
 * Used to enforce min_safe_battery_percent (default 25) so heavy work is skipped when low.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MIN_SAFE_BATTERY_DEFAULT = 25;
const DISCHARGING_MIN_SAFE_BATTERY_DEFAULT = 45;

type BatteryPowerSource = "ac" | "battery" | "unknown";

export type BatterySnapshot = {
  percent: number | null;
  charging: boolean | null;
  powerSource: BatteryPowerSource;
  status: string | null;
};

export type BatteryGuard = {
  batteryPercent: number | null;
  charging: boolean | null;
  powerSource: BatteryPowerSource;
  status: string | null;
  baseMinSafeBatteryPercent: number;
  effectiveMinSafeBatteryPercent: number;
  dischargingMinSafeBatteryPercent: number;
  isLowBattery: boolean;
};

function parsePercent(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return n;
}

function parsePowerSource(raw: string | null | undefined): BatteryPowerSource {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized.includes("ac") || normalized.includes("mains") || normalized.includes("adapter")) {
    return "ac";
  }
  if (normalized.includes("battery")) {
    return "battery";
  }
  return "unknown";
}

function parseCharging(raw: string | null | undefined): boolean | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "charging", "charged"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "discharging", "not_charging", "not-charging"].includes(normalized)) {
    return false;
  }
  return null;
}

function parsePercentConfig(raw: string | undefined, fallback: number): number {
  const parsed = parsePercent(raw ?? null);
  return parsed ?? fallback;
}

export function parsePmsetBattery(out: string): BatterySnapshot {
  const percentMatch = out.match(/(\d+)%/);
  const sourceMatch = out.match(/Now drawing from '([^']+)'/i);
  const statusMatch = out.match(/\d+%;\s*([^;]+);/i);

  const powerSource = parsePowerSource(sourceMatch?.[1] ?? null);
  const status = statusMatch?.[1]?.trim().toLowerCase() ?? null;
  const percent = parsePercent(percentMatch?.[1] ?? null);
  let charging = parseCharging(status);

  // If pmset does not expose charging state but source is AC, treat as externally powered.
  if (charging === null && powerSource === "ac") {
    charging = true;
  }

  return {
    percent,
    charging,
    powerSource,
    status,
  };
}

/** Read min_safe_battery_percent from work-queue.json if present; else default. */
export function getMinSafeBatteryPercent(repoRoot: string): number {
  const workQueuePath = path.join(
    repoRoot,
    process.env.ORCHESTRATOR_WORK_QUEUE_PATH ?? "reports/orchestrator/work-queue.json"
  );
  try {
    const raw = fs.readFileSync(workQueuePath, "utf8");
    const data = JSON.parse(raw) as { min_safe_battery_percent?: number };
    if (typeof data.min_safe_battery_percent === "number") {
      return data.min_safe_battery_percent;
    }
  } catch {
    // file missing or invalid
  }
  return MIN_SAFE_BATTERY_DEFAULT;
}

/** Charging-aware battery snapshot from env override and/or macOS pmset. */
export function getBatterySnapshot(): BatterySnapshot {
  const envPercent = parsePercent(process.env.BATTERY_PERCENT ?? null);
  const envCharging = parseCharging(process.env.BATTERY_CHARGING ?? null);
  const envPowerSource = parsePowerSource(process.env.BATTERY_POWER_SOURCE ?? null);

  let pmset: BatterySnapshot | null = null;
  if (os.platform() === "darwin") {
    try {
      const out = execSync("pmset -g batt", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      pmset = parsePmsetBattery(out);
    } catch {
      // pmset not available or parse failed
    }
  }

  return {
    percent: envPercent ?? pmset?.percent ?? null,
    charging: envCharging ?? pmset?.charging ?? null,
    powerSource: envPowerSource !== "unknown" ? envPowerSource : pmset?.powerSource ?? "unknown",
    status: pmset?.status ?? null,
  };
}

/** Get current battery percent from snapshot. */
export function getBatteryPercent(): number | null {
  return getBatterySnapshot().percent;
}

/** Floor used when battery is discharging; defaults to 45% for laptop-preservation mode. */
export function getDischargingMinSafeBatteryPercent(
  repoRoot: string,
  baseMinSafeBatteryPercent?: number
): number {
  const base = baseMinSafeBatteryPercent ?? getMinSafeBatteryPercent(repoRoot);
  const configured = parsePercentConfig(
    process.env.ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT,
    DISCHARGING_MIN_SAFE_BATTERY_DEFAULT
  );
  return Math.max(base, configured);
}

/** Battery guard policy used by sweeps/audits to decide whether heavy work is safe. */
export function getBatteryGuard(repoRoot: string, baseMinSafeBatteryPercent?: number): BatteryGuard {
  const snapshot = getBatterySnapshot();
  const base = baseMinSafeBatteryPercent ?? getMinSafeBatteryPercent(repoRoot);
  const dischargingMin = getDischargingMinSafeBatteryPercent(repoRoot, base);
  const effectiveMin = snapshot.charging === false ? dischargingMin : base;
  const isLowBattery = snapshot.percent !== null && snapshot.percent < effectiveMin;

  return {
    batteryPercent: snapshot.percent,
    charging: snapshot.charging,
    powerSource: snapshot.powerSource,
    status: snapshot.status,
    baseMinSafeBatteryPercent: base,
    effectiveMinSafeBatteryPercent: effectiveMin,
    dischargingMinSafeBatteryPercent: dischargingMin,
    isLowBattery,
  };
}

/** True if battery is below safe floor (or unknown and treat as low for safety). */
export function isLowBattery(repoRoot: string): boolean {
  return getBatteryGuard(repoRoot).isLowBattery;
}
