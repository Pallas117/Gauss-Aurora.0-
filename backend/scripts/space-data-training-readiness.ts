import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TrainingReadinessState = "blocked" | "limited" | "ready_for_offload";

export interface DatasetStats {
  path: string;
  exists: boolean;
  rowCount: number;
  validRows: number;
  invalidRows: number;
  uniqueTimestamps: number;
  inputSteps: number | null;
  featureWidth: number | null;
  targetWidth: number | null;
  coverageHours: number | null;
  holdoutPath: string;
  holdoutExists: boolean;
}

export interface TrainingReadinessReport {
  generatedAt: string;
  readiness: TrainingReadinessState;
  score: number;
  registryPath: string;
  latestReadyModel: {
    version: string | null;
    trainedAt: string | null;
    samples: number;
    status: string | null;
    datasetPath: string;
  };
  dataset: DatasetStats;
  offloadPolicy: {
    required: boolean;
    runbookPath: string;
    runbookPresent: boolean;
  };
  blockers: string[];
  warnings: string[];
  nextActions: string[];
}

interface RegistryModel {
  version?: unknown;
  trained_at?: unknown;
  status?: unknown;
  metrics?: {
    samples?: unknown;
  };
  dataset?: unknown;
}

const DEFAULT_REGISTRY_PATH = "ml/models/registry.json";
const DEFAULT_DATASET_PATH = "ml/data/train_dataset.jsonl";
const OFFLOAD_RUNBOOK_PATH = "docs/SURYA_FINETUNING_OFFLOAD.md";
const MIN_READY_ROWS = 256;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function asFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function loadRegistryModels(registryPath: string): RegistryModel[] {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { models?: RegistryModel[] };
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

function selectLatestReadyModel(models: RegistryModel[]): RegistryModel | null {
  const ready = models.filter((model) => {
    const status = typeof model.status === "string" ? model.status.toLowerCase() : "";
    return status === "ready";
  });
  if (ready.length === 0) return null;
  ready.sort((left, right) => {
    const leftTs = Date.parse(typeof left.trained_at === "string" ? left.trained_at : "");
    const rightTs = Date.parse(typeof right.trained_at === "string" ? right.trained_at : "");
    return (Number.isFinite(rightTs) ? rightTs : -Infinity) - (Number.isFinite(leftTs) ? leftTs : -Infinity);
  });
  return ready[0] ?? null;
}

export function inspectDataset(datasetPathInput: string): DatasetStats {
  const datasetPath = path.resolve(datasetPathInput);
  const holdoutPath = datasetPath.replace(/\.jsonl$/i, ".holdout.jsonl");
  if (!existsSync(datasetPath)) {
    return {
      path: datasetPath,
      exists: false,
      rowCount: 0,
      validRows: 0,
      invalidRows: 0,
      uniqueTimestamps: 0,
      inputSteps: null,
      featureWidth: null,
      targetWidth: null,
      coverageHours: null,
      holdoutPath,
      holdoutExists: existsSync(holdoutPath),
    };
  }

  const lines = readFileSync(datasetPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const timestamps = new Set<string>();
  const parsedTimestamps: number[] = [];

  let validRows = 0;
  let invalidRows = 0;
  let inputSteps: number | null = null;
  let featureWidth: number | null = null;
  let targetWidth: number | null = null;

  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { x?: unknown; y?: unknown; timestamp?: unknown };
      if (!Array.isArray(row.x) || !Array.isArray(row.y) || row.x.length === 0) {
        invalidRows += 1;
        continue;
      }
      const firstVector = Array.isArray(row.x[0]) ? row.x[0] : null;
      if (!firstVector || firstVector.length === 0) {
        invalidRows += 1;
        continue;
      }
      validRows += 1;
      inputSteps = inputSteps ?? row.x.length;
      featureWidth = featureWidth ?? firstVector.length;
      targetWidth = targetWidth ?? row.y.length;
      if (typeof row.timestamp === "string" && row.timestamp.trim().length > 0) {
        timestamps.add(row.timestamp);
        const parsed = Date.parse(row.timestamp);
        if (Number.isFinite(parsed)) {
          parsedTimestamps.push(parsed);
        }
      }
    } catch {
      invalidRows += 1;
    }
  }

  let coverageHours: number | null = null;
  if (parsedTimestamps.length >= 2) {
    const minTs = Math.min(...parsedTimestamps);
    const maxTs = Math.max(...parsedTimestamps);
    coverageHours = Number(((maxTs - minTs) / 3_600_000).toFixed(2));
  }

  return {
    path: datasetPath,
    exists: true,
    rowCount: lines.length,
    validRows,
    invalidRows,
    uniqueTimestamps: timestamps.size,
    inputSteps,
    featureWidth,
    targetWidth,
    coverageHours,
    holdoutPath,
    holdoutExists: existsSync(holdoutPath),
  };
}

export function buildSpaceDataTrainingReadinessReport(
  registryPathInput = DEFAULT_REGISTRY_PATH,
): TrainingReadinessReport {
  const registryPath = path.resolve(registryPathInput);
  const models = loadRegistryModels(registryPath);
  const latestReady = selectLatestReadyModel(models);
  const datasetPath =
    latestReady && typeof latestReady.dataset === "string" && latestReady.dataset.trim().length > 0
      ? latestReady.dataset.trim()
      : DEFAULT_DATASET_PATH;
  const dataset = inspectDataset(datasetPath);
  const samples = Math.max(0, Math.floor(asFiniteNumber(latestReady?.metrics?.samples) ?? 0));
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (!existsSync(registryPath)) {
    blockers.push("Model registry is missing.");
  }
  if (!dataset.exists) {
    blockers.push("Training dataset is missing.");
  }
  if (dataset.exists && dataset.validRows === 0) {
    blockers.push("Training dataset has no valid rows.");
  }
  if (dataset.exists && dataset.validRows > 0 && dataset.validRows < MIN_READY_ROWS) {
    warnings.push(`Training dataset is too small for promotion (${dataset.validRows} < ${MIN_READY_ROWS}).`);
  }
  if (dataset.exists && dataset.invalidRows > 0) {
    warnings.push(`Training dataset contains invalid rows (${dataset.invalidRows}).`);
  }
  if (dataset.exists && !dataset.holdoutExists) {
    warnings.push("Holdout dataset is missing.");
  }
  if (samples <= 0) {
    warnings.push("Latest ready model still reports zero learned samples.");
  }
  if (!existsSync(path.resolve(OFFLOAD_RUNBOOK_PATH))) {
    warnings.push("Surya offload runbook is missing.");
  }

  nextActions.push("Generate a canonical training dataset from real space-weather history.");
  nextActions.push("Create a holdout split before retraining.");
  nextActions.push("Keep any fine-tuning off the 8 GB M1 and use the offload runbook.");
  nextActions.push("Retrain only after the registry can report non-zero samples and valid metrics.");

  let score = 100;
  score -= blockers.length * 30;
  score -= warnings.length * 8;
  if (dataset.exists && dataset.validRows > 0 && dataset.validRows < MIN_READY_ROWS) {
    score -= 12;
  }
  score = Math.max(0, score);

  let readiness: TrainingReadinessState = "blocked";
  if (blockers.length === 0 && warnings.length === 0 && dataset.validRows >= MIN_READY_ROWS && dataset.holdoutExists) {
    readiness = "ready_for_offload";
  } else if (blockers.length === 0 && dataset.validRows > 0) {
    readiness = "limited";
  }

  return {
    generatedAt: new Date().toISOString(),
    readiness,
    score,
    registryPath,
    latestReadyModel: {
      version: typeof latestReady?.version === "string" ? latestReady.version : null,
      trainedAt: typeof latestReady?.trained_at === "string" ? latestReady.trained_at : null,
      samples,
      status: typeof latestReady?.status === "string" ? latestReady.status : null,
      datasetPath: path.resolve(datasetPath),
    },
    dataset,
    offloadPolicy: {
      required: true,
      runbookPath: path.resolve(OFFLOAD_RUNBOOK_PATH),
      runbookPresent: existsSync(path.resolve(OFFLOAD_RUNBOOK_PATH)),
    },
    blockers,
    warnings,
    nextActions,
  };
}

export function writeTrainingReadinessReport(outPath: string, report: TrainingReadinessReport): void {
  const resolved = path.resolve(outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printReport(report: TrainingReadinessReport): void {
  console.log("Space-Data Training Readiness");
  console.log("=============================");
  console.log(`Readiness: ${report.readiness}`);
  console.log(`Score: ${report.score}`);
  console.log(`Dataset: ${report.dataset.path}`);
  console.log(`Dataset rows: ${report.dataset.validRows}/${report.dataset.rowCount}`);
  console.log(`Holdout present: ${report.dataset.holdoutExists}`);
  console.log(`Latest ready model samples: ${report.latestReadyModel.samples}`);
  if (report.blockers.length > 0) {
    console.log("Blockers:");
    for (const blocker of report.blockers) console.log(`- ${blocker}`);
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}

function main(): void {
  const registryPath = argValue("--registry") ?? DEFAULT_REGISTRY_PATH;
  const jsonOut = argValue("--json-out");
  const strict = hasFlag("--strict");
  const report = buildSpaceDataTrainingReadinessReport(registryPath);
  printReport(report);
  if (jsonOut) {
    writeTrainingReadinessReport(jsonOut, report);
  }
  if (strict && report.readiness === "blocked") {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  main();
}
