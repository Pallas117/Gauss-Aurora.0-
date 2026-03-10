/**
 * Full-stack mission config from env. Testable setup phase.
 */

import type { MissionConfig } from "../full-stack-report.js";

export function envValue(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function isTruthy(value: string | null | undefined): boolean {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function loadMissionConfig(): MissionConfig {
  return {
    frontendUrl: envValue("FRONTEND_BASE_URL") ?? "http://127.0.0.1:8080",
    backendUrl: envValue("BACKEND_BASE_URL") ?? "http://127.0.0.1:3001",
    brainUrl: envValue("GAUSS_BRAIN_URL") ?? "http://127.0.0.1:8089/v1",
    ragUrl: envValue("GAUSS_RAG_URL"),
    writeMode: envValue("FULLSTACK_WRITE_MODE") ?? "controlled",
    cleanup: isTruthy(envValue("FULLSTACK_CLEANUP")) || envValue("FULLSTACK_CLEANUP") === null,
    runTrainCheck: isTruthy(envValue("RBAC_TEST_TRAIN")),
    runUiE2E: !isTruthy(envValue("FULLSTACK_SKIP_UI_E2E")),
    runUiMobile: !isTruthy(envValue("FULLSTACK_SKIP_UI_MOBILE")),
  };
}
