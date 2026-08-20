import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkerMeshBroker } from "../workers/mesh/registry.js";
import { createWorkerTaskEnvelope } from "../workers/mesh/broker.js";
import type { WorkerId, WorkerLane, WorkerTaskKind, WorkerTaskPriority, WorkerTaskSource } from "../workers/mesh/types.js";

const WORKER_IDS = new Set<WorkerId>([
  "telemetry-ingest",
  "ssa-analysis",
  "source-policy",
  "command-planner",
  "safe-executor",
  "service-reanimator",
  "offline-repair",
  "event-deposit",
]);
const WORKER_LANES = new Set<WorkerLane>(["runtime", "offline"]);
const TASK_KINDS = new Set<WorkerTaskKind>([
  "telemetry-refresh",
  "ssa-review",
  "source-adjustment",
  "command-request",
  "service-outage",
  "repair-batch",
  "event-lesson",
]);

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function parseWorkerId(value: string | null): WorkerId | null {
  return value && WORKER_IDS.has(value as WorkerId) ? (value as WorkerId) : null;
}

function parseLane(value: string | null): WorkerLane {
  return value && WORKER_LANES.has(value as WorkerLane)
    ? (value as WorkerLane)
    : "offline";
}

function parseKind(value: string | null): WorkerTaskKind {
  return value && TASK_KINDS.has(value as WorkerTaskKind)
    ? (value as WorkerTaskKind)
    : "service-outage";
}

function parsePriority(value: string | null): WorkerTaskPriority {
  return value === "low" || value === "high" ? value : "medium";
}

function parseSource(value: string | null): WorkerTaskSource {
  if (
    value === "runtime" ||
    value === "command-ui" ||
    value === "automation" ||
    value === "picoclaw" ||
    value === "offline-capsule"
  ) {
    return value;
  }
  return "picoclaw";
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

async function main(): Promise<void> {
  const workerId = parseWorkerId(argValue("--worker-id"));
  const lane = parseLane(argValue("--lane"));
  const kind = parseKind(argValue("--kind"));
  const priority = parsePriority(argValue("--priority"));
  const source = parseSource(argValue("--source"));
  const jsonOut = path.resolve(
    argValue("--json-out") ?? "reports/monitoring/worker-dispatch.latest.json",
  );

  const broker = createWorkerMeshBroker({
    ingestionRuntime: {
      getStatus: () => ({
        mode: "active",
        running: false,
        workerInitialized: false,
        transitionCount: 0,
        lastTransitionAt: null,
        lastTransitionSource: "worker-dispatch",
      }),
      setMode: (mode) => ({
        mode,
        running: mode === "active",
        workerInitialized: false,
        transitionCount: 1,
        lastTransitionAt: new Date().toISOString(),
        lastTransitionSource: "worker-dispatch",
      }),
    },
  });

  const task = createWorkerTaskEnvelope({
    lane,
    kind,
    priority,
    source,
    actor: {
      userId: null,
      role: "operator",
    },
    requestedWorkerId: workerId,
    payload: {
      manualRequested: source === "command-ui",
    },
  });

  const execution = await broker.dispatch(task, { followHandoffs: true });
  const report = {
    generatedAt: new Date().toISOString(),
    task,
    result: execution.result,
    workers: broker.listWorkers(),
    queue: broker.getQueue(),
    brokerPolicy: broker.getPolicy(),
  };
  writeJson(jsonOut, report);
  console.log(JSON.stringify(report, null, 2));

  if (execution.result.status === "failed" || execution.result.status === "blocked") {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
