import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModelOrchestratorPairing,
  buildRepairPairingSummary,
  type OfflineRepairBatchLike,
} from "../repair/offline-repair-pairing.js";

type OfflineRepairCapsule = {
  generated_at: string;
  repair_batches?: OfflineRepairBatchLike[];
};

type OfflineRepairPairingArtifact = {
  generated_at: string;
  capsule_generated_at: string | null;
  active_batch_id: string | null;
  summary: ReturnType<typeof buildRepairPairingSummary>;
  batches: Array<OfflineRepairBatchLike & { pairing: ReturnType<typeof buildModelOrchestratorPairing> }>;
};

const DEFAULT_CAPSULE_PATH = "reports/orchestrator/offline-repair-capsule.latest.json";
const DEFAULT_OUTPUT_PATH = "reports/orchestrator/offline-repair-pairing.latest.json";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function readCapsule(capsulePath: string): OfflineRepairCapsule | null {
  if (!existsSync(capsulePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(capsulePath, "utf8")) as OfflineRepairCapsule;
  } catch {
    return null;
  }
}

export function buildOfflineRepairPairingArtifact(capsule: OfflineRepairCapsule): OfflineRepairPairingArtifact {
  const batches = Array.isArray(capsule.repair_batches) ? capsule.repair_batches : [];
  const summary = buildRepairPairingSummary(batches);
  return {
    generated_at: new Date().toISOString(),
    capsule_generated_at: typeof capsule.generated_at === "string" ? capsule.generated_at : null,
    active_batch_id: summary.activeBatchId,
    summary,
    batches: batches.map((batch) => ({
      ...batch,
      pairing: buildModelOrchestratorPairing(batch),
    })),
  };
}

function writeArtifact(outPath: string, artifact: OfflineRepairPairingArtifact): void {
  const resolved = path.resolve(outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function main(): void {
  const capsulePath = path.resolve(argValue("--capsule") ?? DEFAULT_CAPSULE_PATH);
  const outPath = path.resolve(argValue("--json-out") ?? DEFAULT_OUTPUT_PATH);
  const capsule = readCapsule(capsulePath);
  if (!capsule) {
    console.error(
      `Offline repair capsule not found or unreadable at ${capsulePath}. Run npm run repair:offline:capsule first.`,
    );
    process.exitCode = 1;
    return;
  }
  const artifact = buildOfflineRepairPairingArtifact(capsule);
  writeArtifact(outPath, artifact);
  console.log(
    `OFFLINE_REPAIR_PAIRING active_batch=${artifact.active_batch_id ?? "none"} queue_depth=${artifact.summary.queueDepth} output=${outPath}`,
  );
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  main();
}
