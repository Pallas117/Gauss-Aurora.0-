import { defineConfig, devices } from "@playwright/test";
import os from "node:os";

const baseURL = process.env.PW_BASE_URL || "http://127.0.0.1:4173";

const uiUxReportJson =
  process.env.UI_UX_REPORT_JSON === "true" || process.env.UI_UX_REPORT_JSON === "1";
const reporters: Array<string | [string, Record<string, unknown>]> = [["list"]];
if (uiUxReportJson) {
  reporters.push(["json", { outputFile: "reports/progress/ui-ux-granular.latest.json" }]);
}

function resolveWorkers(): number | undefined {
  const explicit = process.env.PW_WORKERS ?? process.env.PLAYWRIGHT_WORKERS;
  if (explicit) {
    const parsed = Number.parseInt(explicit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const freeRamGb = os.freemem() / 1024 / 1024 / 1024;
  const cpuCount = os.cpus().length;
  const powerSave = String(process.env.POWER_SAVE_MODE ?? "").toLowerCase() === "true";

  if (powerSave || freeRamGb < 2.0) {
    return 1;
  }
  if (freeRamGb < 4.0) {
    return Math.max(1, Math.min(2, Math.floor(cpuCount / 4)));
  }
  return Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: resolveWorkers(),
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: reporters,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: baseURL,
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
