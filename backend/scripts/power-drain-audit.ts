/**
 * Power-drain audit: backend cadence (setInterval >= 1000ms), env snapshot, interval scan.
 * Run standalone (audit:power) or as part of test:sweep. Exit 0 if backend cadence passes.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const MIN_CADENCE_MS = 1000;
const cwd = process.cwd();

type IntervalEntry = { file: string; line: number; kind: "setInterval" | "setTimeout"; ms: number };

function hasArg(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function argValue(flag: string): string | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  return typeof v === "string" && !v.startsWith("--") ? v : null;
}

/** Run backend power-polling.test.ts; return true if pass. */
function runBackendCadenceTest(): boolean {
  const proc = spawnSync(
    "node",
    ["--env-file-if-exists=.env", "--import", "tsx", "--test", "backend/power-polling.test.ts"],
    { cwd, encoding: "utf8", stdio: "pipe" }
  );
  return proc.status === 0;
}

/** Env snapshot for power-related vars. */
function envSnapshot(): Record<string, string | number | null> {
  const battery = process.env.BATTERY_PERCENT;
  let batteryVal: number | null = null;
  if (battery !== undefined && battery !== "") {
    const n = parseInt(battery, 10);
    if (!Number.isNaN(n)) batteryVal = n;
  }
  return {
    POWER_SAVE_MODE: process.env.POWER_SAVE_MODE ?? null,
    INGEST_POWER_PROFILE: process.env.INGEST_POWER_PROFILE ?? null,
    VITE_POWER_PROFILE: process.env.VITE_POWER_PROFILE ?? null,
    VITE_POLL_INTERVAL_MULTIPLIER: process.env.VITE_POLL_INTERVAL_MULTIPLIER ?? null,
    BATTERY_PERCENT: batteryVal,
  };
}

/** Read min_safe_battery_percent from work-queue if present. */
function workQueueMinSafeBattery(): number | null {
  const p = path.join(
    cwd,
    process.env.ORCHESTRATOR_WORK_QUEUE_PATH ?? "reports/orchestrator/work-queue.json"
  );
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw) as { min_safe_battery_percent?: number };
    if (typeof data.min_safe_battery_percent === "number") return data.min_safe_battery_percent;
  } catch {
    // ignore
  }
  return null;
}

function* walkTsFiles(dir: string, ext: string[] = [".ts"]): Generator<string> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      yield* walkTsFiles(full, ext);
    } else if (e.isFile()) {
      const ok = ext.some((x) => e.name.endsWith(x));
      if (ok && !e.name.endsWith(".d.ts")) yield full;
    }
  }
}

/** Scan files for setInterval( fn, <literal_ms> ) and setTimeout( fn, <literal_ms> ). */
function scanIntervals(
  dir: string,
  extensions: string[] = [".ts"]
): { setInterval: IntervalEntry[]; setTimeout: IntervalEntry[] } {
  const setIntervals: IntervalEntry[] = [];
  const setTimeouts: IntervalEntry[] = [];
  for (const file of walkTsFiles(dir, extensions)) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    const rel = path.relative(cwd, file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const setIntervalMatch = line.match(/setInterval\s*\(\s*[^,]+,\s*(\d+)/);
      if (setIntervalMatch) {
        setIntervals.push({
          file: rel,
          line: i + 1,
          kind: "setInterval",
          ms: parseInt(setIntervalMatch[1]!, 10),
        });
      }
      const setTimeoutMatch = line.match(/setTimeout\s*\(\s*[^,]+,\s*(\d+)/);
      if (setTimeoutMatch) {
        setTimeouts.push({
          file: rel,
          line: i + 1,
          kind: "setTimeout",
          ms: parseInt(setTimeoutMatch[1]!, 10),
        });
      }
    }
  }
  return { setInterval: setIntervals, setTimeout: setTimeouts };
}

function main(): void {
  const backendCadencePass = runBackendCadenceTest();
  const env = envSnapshot();
  const workQueueMinSafeBatteryPercent = workQueueMinSafeBattery();
  const backendScan = scanIntervals(path.join(cwd, "backend"));
  const frontendScan = { setInterval: [] as IntervalEntry[], setTimeout: [] as IntervalEntry[] };
  const srcDir = path.join(cwd, "src");
  if (fs.existsSync(srcDir)) {
    const s = scanIntervals(srcDir, [".ts", ".tsx"]);
    frontendScan.setInterval.push(...s.setInterval);
    frontendScan.setTimeout.push(...s.setTimeout);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    backend_cadence_pass: backendCadencePass,
    env,
    work_queue_min_safe_battery_percent: workQueueMinSafeBatteryPercent,
    backend_intervals: backendScan.setInterval,
    frontend_intervals: {
      setInterval: frontendScan.setInterval,
      setTimeout: frontendScan.setTimeout,
    },
  };

  const jsonOut = argValue("--json-out");
  if (jsonOut) {
    const resolved = path.resolve(cwd, jsonOut);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  if (!hasArg("--json-only")) {
    console.log("[Power drain audit] Backend cadence (setInterval >= 1000ms):", backendCadencePass ? "PASS" : "FAIL");
    console.log("[Power drain audit] Env:", JSON.stringify(env, null, 2));
    console.log("[Power drain audit] Backend setInterval count:", backendScan.setInterval.length);
    console.log("[Power drain audit] Frontend setInterval/setTimeout (advisory):", frontendScan.setInterval.length, "/", frontendScan.setTimeout.length);
  }

  if (hasArg("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  }

  process.exit(backendCadencePass ? 0 : 1);
}

main();
