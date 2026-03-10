/**
 * Scaffold test and debug assets for the orchestrator.
 * Writes reports/orchestrator/debug-profile.json and work-queue.json so
 * test:sweep:debug and orchestrator runs use optimised debug settings.
 */
import * as fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ORCH_DIR = path.join(REPO_ROOT, "reports", "orchestrator");

const DEBUG_PROFILE = {
  min_safe_battery_percent: 10,
  skip_ui_e2e: true,
  skip_playwright: true,
  playwright_workers: 1,
  rust_test_args: ["--", "--nocapture", "--test-threads=1"],
  backend_test_args: ["--test-concurrency=1"],
  verbose: true,
  write_sweep_report: true,
  createdAt: new Date().toISOString(),
  purpose: "Optimise tests and debug: lower battery floor, single-threaded, verbose, sweep report written to reports/orchestrator/sweep-debug.json",
};

const WORK_QUEUE_DEBUG = {
  min_safe_battery_percent: 10,
  debug: true,
  createdAt: new Date().toISOString(),
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function main(): void {
  ensureDir(ORCH_DIR);

  const debugPath = path.join(ORCH_DIR, "debug-profile.json");
  fs.writeFileSync(debugPath, JSON.stringify(DEBUG_PROFILE, null, 2), "utf8");
  console.log(`[scaffold] Wrote ${debugPath}`);

  const workQueuePath = path.join(ORCH_DIR, "work-queue.json");
  fs.writeFileSync(workQueuePath, JSON.stringify(WORK_QUEUE_DEBUG, null, 2), "utf8");
  console.log(`[scaffold] Wrote ${workQueuePath}`);

  console.log("[scaffold] Run with: npm run test:sweep:debug (or FULL_E2E_SWEEP=true ORCHESTRATOR_DEBUG=true npm run test:sweep)");
}

main();
