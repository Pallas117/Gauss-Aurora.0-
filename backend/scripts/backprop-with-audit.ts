/**
 * Battery-aware backprop driver: at sufficient battery runs audit then context:backprop;
 * at low battery skips audit and runs context:backprop only (capsule uses existing audit if present).
 */
import { execSync } from "node:child_process";
import { getBatteryGuard } from "./battery-and-work-queue.js";

const repoRoot = process.cwd();

function hasArg(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function main(): void {
  const noBatteryCheck = hasArg("--no-battery-check");

  if (!noBatteryCheck) {
    const batteryGuard = getBatteryGuard(repoRoot);
    const battery = batteryGuard.batteryPercent;
    if (battery !== null && batteryGuard.isLowBattery) {
      const chargingLabel =
        batteryGuard.charging === null
          ? "unknown"
          : batteryGuard.charging
            ? "charging"
            : "discharging";
      console.warn(
        `[Backprop] Battery ${battery}% (${chargingLabel}) below min_safe_battery_percent (${batteryGuard.effectiveMinSafeBatteryPercent}); skipping audit, running context:backprop only. Use --no-battery-check to run full audit.`,
      );
      execSync("npm run context:backprop", {
        stdio: "inherit",
        cwd: repoRoot,
      });
      return;
    }
  }

  execSync("npm run audit:adherence:record", {
    stdio: "inherit",
    cwd: repoRoot,
  });
  execSync("npm run context:backprop", {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

main();
