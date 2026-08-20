import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { checkLocalChatEngine } from "./local-chat-engine-check.ts";

interface StepResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface RepairReport {
  generatedAt: string;
  steps: StepResult[];
  localChatEngine: Awaited<ReturnType<typeof checkLocalChatEngine>>;
}

function runStep(command: string): StepResult {
  const result = spawnSync("sh", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
  });

  return {
    command,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

async function main(): Promise<void> {
  const steps = [
    runStep("node --env-file-if-exists=.env --import tsx backend/scripts/offline-repair-capsule.ts"),
    runStep("node --env-file-if-exists=.env --import tsx backend/scripts/offline-repair-pairing.ts"),
  ];
  const localChatEngine = await checkLocalChatEngine();

  const report: RepairReport = {
    generatedAt: new Date().toISOString(),
    steps,
    localChatEngine,
  };

  const outPath = path.resolve("reports/monitoring/offline-fetch-self-repair.latest.json");
  writeJson(outPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (steps.some((step) => !step.ok)) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
