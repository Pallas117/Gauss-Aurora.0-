/**
 * Battery state cache for power-safe scheduling (25% rule).
 * Devices = high-value assets; never run heavy polling when battery is low and discharging.
 */

const MIN_SAFE_LEVEL = 0.25;
const RECHARGE_PROTECT_LEVEL = 0.5;
const RECOVERY_LEVEL = 0.5;
const SURPLUS_MIN_LEVEL = 0.7;
const CARE_CAP_LEVEL = 0.9;
const SLOW_CHARGE_SECONDS = 30 * 60;
type BatteryDrainMode = "recharge-first" | "balanced" | "performance";
export type BatteryPowerFlow = "recovery" | "balanced" | "surplus";

type BatteryState = {
  level: number;
  charging: boolean;
  chargingTime: number | null;
  dischargingTime: number | null;
};

let cached: BatteryState | null = null;
let listenerStarted = false;

function parseBatteryDrainMode(raw: string | undefined): BatteryDrainMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (["recharge-first", "recharge", "max-recharge", "eco", "battery"].includes(normalized)) {
    return "recharge-first";
  }
  if (["performance", "throughput", "max-performance"].includes(normalized)) {
    return "performance";
  }
  return "balanced";
}

function normalizeTimerSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function updateCache(level: number, charging: boolean, chargingTime: number, dischargingTime: number) {
  cached = {
    level,
    charging,
    chargingTime: normalizeTimerSeconds(chargingTime),
    dischargingTime: normalizeTimerSeconds(dischargingTime),
  };
}

function startBatteryListener() {
  if (listenerStarted || typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      chargingTime: number;
      dischargingTime: number;
      addEventListener: (type: string, fn: () => void) => void;
    }>;
  };
  const getBattery = nav.getBattery;
  if (typeof getBattery !== "function") return;
  listenerStarted = true;
  getBattery()
    .then((b) => {
      const sync = () => updateCache(b.level, b.charging, b.chargingTime, b.dischargingTime);
      sync();
      b.addEventListener("levelchange", sync);
      b.addEventListener("chargingchange", sync);
      b.addEventListener("chargingtimechange", sync);
      b.addEventListener("dischargingtimechange", sync);
    })
    .catch(() => {});
}

function resolveBatteryPowerFlow(): BatteryPowerFlow {
  if (cached == null) return "balanced";
  if ((!cached.charging && cached.level < MIN_SAFE_LEVEL) || cached.level < RECOVERY_LEVEL) {
    return "recovery";
  }
  if (
    cached.charging &&
    cached.level >= SURPLUS_MIN_LEVEL &&
    cached.level < CARE_CAP_LEVEL &&
    (cached.chargingTime == null || cached.chargingTime <= SLOW_CHARGE_SECONDS)
  ) {
    return "surplus";
  }
  return "balanced";
}

export function getBatteryPowerFlow(): BatteryPowerFlow {
  if (typeof window !== "undefined") startBatteryListener();
  return resolveBatteryPowerFlow();
}

/**
 * True when battery is known, below 25%, and not charging — back off polling to preserve device.
 */
export function isBatteryLowAndDischarging(): boolean {
  if (typeof window !== "undefined") startBatteryListener();
  if (cached == null) return false;
  return !cached.charging && cached.level < MIN_SAFE_LEVEL;
}

/**
 * Charging-flow aware drain multiplier for poll scheduling.
 * > 1 means polling should back off to favor battery recharge / preserve charge.
 */
export function getBatteryDrainMultiplier(): number {
  if (typeof window !== "undefined") startBatteryListener();
  if (cached == null) return 1;

  const mode = parseBatteryDrainMode(
    (typeof import_meta !== "undefined"
      ? import_meta?.env?.VITE_BATTERY_DRAIN_MODE
      : typeof process !== "undefined"
        ? process.env?.VITE_BATTERY_DRAIN_MODE
        : undefined),
  );
  const flow = resolveBatteryPowerFlow();

  if (mode === "recharge-first") {
    if (!cached.charging) {
      if (cached.level < 0.25) return 4;
      if (cached.level < 0.35) return 3.5;
      if (cached.level < 0.45) return 3;
      if (cached.level < 0.6) return 2.5;
      return 2;
    }

    if (cached.level < RECHARGE_PROTECT_LEVEL) {
      if (cached.chargingTime == null || cached.chargingTime > SLOW_CHARGE_SECONDS) {
        return 2;
      }
    }
    if (cached.level < 0.7) {
      return 1.5;
    }
    return 1;
  }

  if (mode === "performance") {
    if (flow === "surplus") {
      return 0.8;
    }
    if (!cached.charging) {
      if (cached.level < 0.25) return 2.5;
      if (cached.level < 0.35) return 2;
      if (cached.level < 0.45) return 1.75;
      if (cached.level < 0.6) return 1.5;
      return 1.25;
    }

    if (cached.level < RECHARGE_PROTECT_LEVEL) {
      return 1.1;
    }
    return 1;
  }

  if (flow === "surplus") {
    return 0.9;
  }

  if (!cached.charging) {
    if (cached.level < 0.25) return 4;
    if (cached.level < 0.35) return 3;
    if (cached.level < 0.45) return 2.5;
    if (cached.level < 0.6) return 2;
    return 1.5;
  }

  if (cached.level < RECHARGE_PROTECT_LEVEL) {
    // When charge ramp is slow/unknown and battery still low, keep a mild backoff.
    if (cached.chargingTime == null || cached.chargingTime > SLOW_CHARGE_SECONDS) {
      return 1.5;
    }
  }

  return 1;
}
