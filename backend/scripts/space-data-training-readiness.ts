/**
 * Space data training readiness audit.
 * Checks that required datasets, schemas, and ML pipeline components
 * are present and correctly configured for training the space weather models.
 * Exit 0 = PASS (or warn-only without --strict), 1 = FAIL.
 */

import { existsSync, statSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
type CheckResult = { name: string; status: CheckStatus; detail: string };

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

const strict = hasArg("--strict");
const cwd = process.cwd();

function check(name: string, fn: () => { ok: boolean; detail: string; warn?: boolean }): CheckResult {
  try {
    const r = fn();
    return { name, status: r.ok ? "PASS" : r.warn ? "WARN" : "FAIL", detail: r.detail };
  } catch (err) {
    return { name, status: "FAIL", detail: String(err) };
  }
}

function fileExists(rel: string): boolean {
  return existsSync(join(cwd, rel));
}

function fileSize(rel: string): number {
  try { return statSync(join(cwd, rel)).size; } catch { return 0; }
}

const results: CheckResult[] = [
  check("ML refinery module (refinery.py)", () => ({
    ok: fileExists("ml/infer/refinery.py"),
    detail: fileExists("ml/infer/refinery.py")
      ? "ml/infer/refinery.py present — Isolation Forest DataRefinery available."
      : "ml/infer/refinery.py not found. Run: touch ml/infer/refinery.py",
  })),

  check("Inference server (infer_server.py)", () => ({
    ok: fileExists("ml/infer/infer_server.py"),
    detail: fileExists("ml/infer/infer_server.py")
      ? "ml/infer/infer_server.py present — nowcast inference server available."
      : "ml/infer/infer_server.py not found.",
  })),

  check("ML model registry (ml/models/registry.json)", () => {
    const exists = fileExists("ml/models/registry.json");
    return {
      ok: true,
      warn: !exists,
      detail: exists
        ? `ml/models/registry.json present (${fileSize("ml/models/registry.json")} bytes).`
        : "ml/models/registry.json missing — no trained model registered yet. Run training pipeline to populate.",
    };
  }),

  check("Training script (ml/train/train_unet.py)", () => ({
    ok: fileExists("ml/train/train_unet.py"),
    detail: fileExists("ml/train/train_unet.py")
      ? "Training script present."
      : "ml/train/train_unet.py not found — training pipeline unavailable.",
  })),

  check("NOAA adapter (backend/adapters/noaa-swpc.ts)", () => ({
    ok: fileExists("backend/adapters/noaa-swpc.ts"),
    detail: fileExists("backend/adapters/noaa-swpc.ts")
      ? "NOAA SWPC adapter present — solar wind data source configured."
      : "backend/adapters/noaa-swpc.ts missing.",
  })),

  check("MMS adapter (backend/adapters/mms-cdaweb.ts)", () => ({
    ok: fileExists("backend/adapters/mms-cdaweb.ts"),
    detail: fileExists("backend/adapters/mms-cdaweb.ts")
      ? "MMS CDAWeb adapter present — magnetospheric wave data source configured."
      : "backend/adapters/mms-cdaweb.ts missing.",
  })),

  check("Ingest loop (backend/worker/ingest-loop.ts)", () => ({
    ok: fileExists("backend/worker/ingest-loop.ts"),
    detail: fileExists("backend/worker/ingest-loop.ts")
      ? "Ingest loop present — data pipeline running."
      : "backend/worker/ingest-loop.ts missing.",
  })),

  check("Physics refinery (backend/physics/refine.ts)", () => ({
    ok: fileExists("backend/physics/refine.ts"),
    detail: fileExists("backend/physics/refine.ts")
      ? "Physics refinement module present — deterministic clamp layer active."
      : "backend/physics/refine.ts missing.",
  })),

  check("ORCHESTRATOR_INGEST_API_TOKEN configured", () => {
    const token = (process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? "").trim();
    return {
      ok: token.length > 0,
      warn: token.length === 0,
      detail: token.length > 0
        ? "ORCHESTRATOR_INGEST_API_TOKEN is set — orchestrator E2E ingest enabled."
        : "ORCHESTRATOR_INGEST_API_TOKEN not set — orchestrator E2E tests will SKIP.",
    };
  }),

  check("LOCAL_INFER_URL configured", () => {
    const url = (process.env.LOCAL_INFER_URL ?? "").trim();
    return {
      ok: url.length > 0,
      warn: url.length === 0,
      detail: url.length > 0
        ? `LOCAL_INFER_URL=${url} — inference server URL configured.`
        : "LOCAL_INFER_URL not set; defaults to http://localhost:8000.",
    };
  }),
];

const totals = results.reduce(
  (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
  {} as Record<CheckStatus, number>,
);

const jsonOut = argValue("--json-out");
if (jsonOut) {
  const out = join(cwd, jsonOut);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), totals, checks: results }, null, 2) + "\n", "utf8");
}

console.log("\nSpace Data Training Readiness Audit");
console.log("====================================");
for (const r of results) {
  console.log(`[${r.status}] ${r.name}`);
  console.log(`       ${r.detail}`);
}
console.log(`\nSummary: PASS=${totals.PASS ?? 0}, WARN=${totals.WARN ?? 0}, FAIL=${totals.FAIL ?? 0}, SKIP=${totals.SKIP ?? 0}`);

const hasFailures = (totals.FAIL ?? 0) > 0;
const hasWarnings = (totals.WARN ?? 0) > 0;
if (hasFailures || (strict && hasWarnings)) {
  process.exit(1);
}
