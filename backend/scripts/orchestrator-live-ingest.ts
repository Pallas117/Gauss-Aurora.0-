#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

function withDefault(name: string, fallback: string): string {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function normalizeOrchestratorLocalPath(input: string): string {
  const trimmed = input.trim();
  const prefix = "./gauss-orchestrator/";
  if (trimmed.startsWith(prefix)) {
    return `./${trimmed.slice(prefix.length)}`;
  }
  return trimmed;
}

function main(): void {
  const token = (process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? "").trim();
  if (!token) {
    console.error("ORCHESTRATOR_INGEST_API_TOKEN is required for live ingest.");
    process.exit(1);
  }

  const env = {
    ...process.env,
    ORCHESTRATOR_INGEST_API_URL: withDefault(
      "ORCHESTRATOR_INGEST_API_URL",
      "http://127.0.0.1:3001/api/ingest/telemetry/packets",
    ),
    ORCHESTRATOR_XTCE_PATH: normalizeOrchestratorLocalPath(
      withDefault(
        "ORCHESTRATOR_XTCE_PATH",
        "./config/xtce/baseline.xtce.xml",
      ),
    ),
    ORCHESTRATOR_APID_MAP_PATH: normalizeOrchestratorLocalPath(
      withDefault(
        "ORCHESTRATOR_APID_MAP_PATH",
        "./config/xtce/apid-map.json",
      ),
    ),
    ORCHESTRATOR_INGEST_API_TOKEN: token,
  };

  const cwd = path.join(process.cwd(), "gauss-orchestrator");
  const result = spawnSync(
    "cargo",
    ["run", "--quiet", "--", "--process-file", "tests/fixtures/ccsds_valid.bin"],
    {
      cwd,
      env,
      stdio: "inherit",
    },
  );

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(1);
}

main();
