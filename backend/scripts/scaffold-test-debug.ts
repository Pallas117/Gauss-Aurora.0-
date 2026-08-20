/**
 * scaffold-test-debug — print environment and runtime info for test debugging.
 * Useful for diagnosing flaky tests, missing env, or wrong Node/tsx versions.
 *
 * Usage: npm run scaffold:test-debug
 */

import os from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();

const info = {
  node: process.version,
  platform: `${os.platform()} ${os.release()} (${os.arch()})`,
  cpus: os.cpus().length,
  ramGb: (os.totalmem() / 1e9).toFixed(1),
  freeRamGb: (os.freemem() / 1e9).toFixed(1),
  cwd,
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "(unset)",
    GAUSS_AIR_GAP: process.env.GAUSS_AIR_GAP ?? "(unset)",
    LOCAL_INFER_URL: process.env.LOCAL_INFER_URL ?? "(unset)",
    GAUSS_BRAIN_URL: process.env.GAUSS_BRAIN_URL ?? "(unset)",
    ORCHESTRATOR_INGEST_API_TOKEN: process.env.ORCHESTRATOR_INGEST_API_TOKEN
      ? `${process.env.ORCHESTRATOR_INGEST_API_TOKEN.slice(0, 8)}…`
      : "(unset)",
    SUPABASE_URL: process.env.SUPABASE_URL?.slice(0, 40) ?? "(unset)",
    POWER_SAVE_MODE: process.env.POWER_SAVE_MODE ?? "(unset)",
  },
  keyFiles: [
    "backend/worker/ingest-loop.ts",
    "backend/cybertiger/daemon.ts",
    "ml/infer/refinery.py",
    "ml/infer/infer_server.py",
    "ml/models/registry.json",
    ".env",
  ].map((f) => ({ path: f, exists: existsSync(join(cwd, f)) })),
};

console.log("Gauss Test Debug Scaffold");
console.log("=========================");
console.log(JSON.stringify(info, null, 2));
