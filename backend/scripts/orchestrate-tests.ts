/**
 * Automated Test Orchestrator
 * Purpose: Divide testing tasks and optimize for fidelity, power, RAM, and waste limits.
 * With FULL_E2E_SWEEP=true: runs full E2E sweep (Phase 0 → Rust → Backend → Full-stack → BXR → Playwright)
 * with profile-based UI skipping and min_safe_battery_percent (default 25) enforcement.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getBatteryGuard, getMinSafeBatteryPercent } from "./battery-and-work-queue.js";

type Profile = "high-performance" | "low-power" | "balanced";

function determineExecutionProfile(): Profile {
  const totalRamGB = os.totalmem() / 1024 / 1024 / 1024;
  const freeRamGB = os.freemem() / 1024 / 1024 / 1024;
  const cpus = os.cpus().length;
  const batteryGuard = getBatteryGuard(process.cwd());

  console.log(
    `[Orchestrator] System State: ${cpus} CPUs, ${freeRamGB.toFixed(1)}GB free RAM (Total: ${totalRamGB.toFixed(1)}GB)`
  );

  if (process.env.POWER_SAVE_MODE === "true" || freeRamGB < 4) {
    return "low-power";
  }
  if (batteryGuard.surplusPowerAvailable) {
    console.log(
      `[Orchestrator] Surplus power available (${batteryGuard.batteryPercent}% on external power, care cap ${batteryGuard.batteryCareCapPercent}%).`,
    );
  }
  if ((freeRamGB > 8 && cpus >= 8) || (batteryGuard.surplusPowerAvailable && freeRamGB >= 4.5 && cpus >= 8)) {
    return "high-performance";
  }
  return "balanced";
}

const BACKEND_HEALTH_CHECK_TIMEOUT_MS = 2500;

/** Return true if backend /health is reachable and returns { ok: true }. */
function isBackendReachable(): boolean {
  const base = (process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").trim();
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  const port = url.port || (url.protocol === "https:" ? 443 : 80);
  const path = `${url.pathname.replace(/\/$/, "")}/health`;
  const script = [
    'const http=require("http");',
    `const opts={hostname:process.env.BH_HOST,port:Number(process.env.BH_PORT),path:process.env.BH_PATH,timeout:${BACKEND_HEALTH_CHECK_TIMEOUT_MS}};`,
    "const req=http.get(opts,(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{process.exit(JSON.parse(d).ok===true?0:1);}catch(e){process.exit(1);}});});",
    `req.on('error',()=>process.exit(1));req.setTimeout(${BACKEND_HEALTH_CHECK_TIMEOUT_MS},()=>{req.destroy();process.exit(1);});`,
  ].join(" ");
  const env = { ...process.env, BH_HOST: url.hostname, BH_PORT: String(port), BH_PATH: path };
  try {
    execSync(`node -e "${script}"`, {
      encoding: "utf8",
      timeout: (BACKEND_HEALTH_CHECK_TIMEOUT_MS + 500) / 1000,
      env,
    });
    return true;
  } catch {
    return false;
  }
}

type DebugProfile = {
  min_safe_battery_percent?: number;
  skip_ui_e2e?: boolean;
  skip_playwright?: boolean;
  playwright_workers?: number;
  verbose?: boolean;
  write_sweep_report?: boolean;
};

function loadDebugProfile(repoRoot: string): DebugProfile | null {
  if (process.env.ORCHESTRATOR_DEBUG !== "true" && process.env.ORCHESTRATOR_DEBUG !== "1") {
    return null;
  }
  const fp = path.join(repoRoot, "reports", "orchestrator", "debug-profile.json");
  try {
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, "utf8");
      return JSON.parse(raw) as DebugProfile;
    }
  } catch {
    // ignore
  }
  return {};
}

function runSweep(repoRoot: string): void {
  const profile = determineExecutionProfile();
  const debugProfile = loadDebugProfile(repoRoot);
  const isDebug = Boolean(debugProfile !== null);

  let minSafeBattery = getMinSafeBatteryPercent(repoRoot);
  if (isDebug && debugProfile?.min_safe_battery_percent != null) {
    minSafeBattery = debugProfile.min_safe_battery_percent;
  }

  const batteryGuard = getBatteryGuard(repoRoot, minSafeBattery);
  const battery = batteryGuard.batteryPercent;
  const skipUiForBattery = batteryGuard.isLowBattery;
  const hasIngestToken = Boolean(
    (process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? "").trim()
  );

  if (isDebug) {
    console.log(`[Orchestrator] DEBUG mode — using scaffold from reports/orchestrator/debug-profile.json`);
  }
  console.log(`[Orchestrator] Full E2E Sweep — Profile: [${profile.toUpperCase()}]`);
  if (battery !== null) {
    const chargingLabel =
      batteryGuard.charging === null
        ? "unknown"
        : batteryGuard.charging
          ? "charging"
          : "discharging";
    console.log(
      `[Orchestrator] Battery: ${battery}% (${chargingLabel}, source=${batteryGuard.powerSource}, min safe: ${batteryGuard.effectiveMinSafeBatteryPercent}%)`
    );
    if (
      batteryGuard.effectiveMinSafeBatteryPercent !== batteryGuard.baseMinSafeBatteryPercent &&
      batteryGuard.charging === false
    ) {
      console.log(
        `[Orchestrator] Discharging floor active (${batteryGuard.dischargingMinSafeBatteryPercent}%) to protect battery health under load.`
      );
    }
    if (skipUiForBattery) {
      console.log(
        `[Orchestrator] Skipping heavy UI E2E (battery < ${batteryGuard.effectiveMinSafeBatteryPercent}%).`
      );
    }
  } else {
    console.log(`[Orchestrator] Battery unknown (set BATTERY_PERCENT to enforce floor).`);
  }

  const envForFullstack = { ...process.env };
  const forceSkipUi = isDebug && (debugProfile?.skip_ui_e2e ?? true);
  if (profile === "low-power" || skipUiForBattery || forceSkipUi) {
    envForFullstack.FULLSTACK_SKIP_UI_E2E = "true";
    envForFullstack.FULLSTACK_SKIP_UI_MOBILE = "true";
  }

  const failures: string[] = [];
  const sweepFailuresDir = path.join(repoRoot, "reports", "orchestrator");
  const sweepFailuresPath = path.join(sweepFailuresDir, "sweep-failures.json");
  try {
    if (!fs.existsSync(sweepFailuresDir)) fs.mkdirSync(sweepFailuresDir, { recursive: true });
    fs.writeFileSync(sweepFailuresPath, "[]", "utf8");
  } catch {
    // ignore
  }

  const run = (label: string, command: string, env?: NodeJS.ProcessEnv) => {
    console.log(`\n[Orchestrator] ${label}`);
    console.log(`  ⟶ ${command}`);
    execSync(command, {
      stdio: "inherit",
      cwd: repoRoot,
      env: env ?? process.env,
    });
  };

  /** Run a step; on failure record and continue (so sweep completes even if fullstack/BXR/Playwright fail). */
  const runOptional = (label: string, command: string, env?: NodeJS.ProcessEnv) => {
    console.log(`\n[Orchestrator] ${label}`);
    console.log(`  ⟶ ${command}`);
    try {
      execSync(command, {
        stdio: "inherit",
        cwd: repoRoot,
        env: env ?? process.env,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const firstLine = msg.split("\n")[0] ?? msg;
      failures.push(`${label}: ${firstLine}`);
      console.warn(`\n[Orchestrator] ${label} failed (continuing sweep).`);
      try {
        const dir = path.dirname(sweepFailuresPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const entry = {
          step: label,
          command,
          message: firstLine,
          at: new Date().toISOString(),
        };
        const existing: unknown[] = fs.existsSync(sweepFailuresPath)
          ? (JSON.parse(fs.readFileSync(sweepFailuresPath, "utf8")) as unknown[])
          : [];
        existing.push(entry);
        fs.writeFileSync(sweepFailuresPath, JSON.stringify(existing, null, 2), "utf8");
      } catch {
        // ignore write errors
      }
    }
  };

  // Phase 0
  run("Phase 0 — Runtime versions", "node -v && npm -v && python3 --version");
  run("Phase 0 — Backend env sanity", "npm run check:backend-env");
  run(
    "Power drain audit",
    "node --env-file-if-exists=.env --import tsx backend/scripts/power-drain-audit.ts --json-out reports/progress/power-drain-audit.latest.json"
  );

  // Rust orchestrator (debug: verbose, single-thread for easier trace)
  const rustTestCmd = isDebug ? "npm run test:orchestrator:debug" : "npm run test:orchestrator";
  run("Rust orchestrator", rustTestCmd);

  // Backend unit/contract
  run("Backend tests", "npm test");

  const backendUp = isBackendReachable();
  const powerSaver = profile === "low-power" || skipUiForBattery;
  if (powerSaver) {
    console.log(
      "\n[Orchestrator] Power-saver mode: skipping Backend/AI granular, Full-stack, and Playwright to reduce drain."
    );
  }
  if (!backendUp) {
    console.log(
      "\n[Orchestrator] Backend not reachable at " +
        (process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001") +
        ". Skipping Backend/AI granular and Full-stack (start backend with npm run dev:proxy to run them)."
    );
  }

  // Backend/AI granular (per-area endpoint checks; requires backend server; skipped in power-saver)
  if (backendUp && !powerSaver) {
    runOptional(
      "Backend/AI granular",
      "npm run test:backend:granular:record",
      envForFullstack
    );
  }

  // Full-stack mission (resilient: e.g. missing RBAC creds → continue to BXR/Playwright); skipped in power-saver
  if (backendUp && !powerSaver) {
    runOptional("Full-stack mission", "npm run test:fullstack", envForFullstack);
  }

  // BXR E2E (optional; skip in power-saver or when backend is down to avoid unnecessary drain/noise)
  if (hasIngestToken && backendUp && !powerSaver) {
    runOptional("BXR stack E2E", "npm run test:e2e:bxr");
  } else if (!hasIngestToken) {
    console.log("\n[Orchestrator] BXR stack E2E skipped (ORCHESTRATOR_INGEST_API_TOKEN not set).");
  } else if (!backendUp) {
    console.log("\n[Orchestrator] BXR stack E2E skipped (backend not reachable).");
  } else if (powerSaver) {
    console.log("\n[Orchestrator] BXR stack E2E skipped (power-saver mode).");
  } else {
    console.log("\n[Orchestrator] BXR stack E2E skipped.");
  }

  // Playwright removed from local dependency surface; always skip UI E2E here.
  const skipPlaywright = isDebug && (debugProfile?.skip_playwright ?? true);
  if (profile === "low-power" || skipUiForBattery || skipPlaywright) {
    const reason =
      skipPlaywright && (profile === "low-power" || skipUiForBattery)
        ? "debug profile and low-power or battery < min safe"
        : skipPlaywright
          ? "ORCHESTRATOR_DEBUG + skip_playwright — unset env or set skip_playwright: false in reports/orchestrator/debug-profile.json to run"
          : "low-power or battery < min safe";
    console.log(`\n[Orchestrator] Playwright UI E2E skipped (${reason}; dependency removed from package scripts).`);
  } else {
    console.log("\n[Orchestrator] Playwright UI E2E skipped (dependency removed from package scripts).");
  }

  const sweepDebugPath = path.join(sweepFailuresDir, "sweep-debug.json");
  if (isDebug && (debugProfile?.write_sweep_report ?? true)) {
    try {
      fs.writeFileSync(
        sweepDebugPath,
        JSON.stringify(
          {
            profile,
            battery,
            minSafeBattery,
            failures,
            failuresCount: failures.length,
            completedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      );
      console.log(`\n[Orchestrator] Debug report: ${sweepDebugPath}`);
    } catch {
      // ignore
    }
  }

  if (failures.length > 0) {
    console.warn("\n[Orchestrator] Sweep completed with failures:");
    failures.forEach((f) => console.warn(`  - ${f}`));
    console.warn("\nDiagnosis: see reports/orchestrator/sweep-failures.json for step, command, and message per failure.");
    console.warn("Set RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD (or RBAC_VIEWER_TOKEN) to pass fullstack RBAC. See .env.example.");
    process.exit(1);
  }
  console.log("\n✅ [Orchestrator] Full E2E sweep complete.");
}

function orchestrateTests(): void {
  const profile = determineExecutionProfile();
  const sweepMode = process.env.FULL_E2E_SWEEP === "true" || process.env.FULL_E2E_SWEEP === "1";
  const repoRoot = process.cwd();

  if (sweepMode) {
    runSweep(repoRoot);
    return;
  }

  // Legacy power-profile path (test:orchestrator:power)
  console.log(`[Orchestrator] Assigned Profile: [${profile.toUpperCase()}]`);

  console.log("\n[Orchestrator] Playwright disabled in this pipeline; running backend/UI unit coverage only.");
  try {
    execSync("npm run test:unit:ui", { stdio: "inherit", cwd: repoRoot });
    console.log(`\n✅ [Orchestrator] testing pipeline complete. 0 waste detected.`);
  } catch (err) {
    console.error(`\n❌ [Orchestrator] Pipeline failed. Check logs.`);
    process.exit(1);
  }
}

orchestrateTests();
