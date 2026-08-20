import { randomUUID } from "node:crypto";
import {
  type RuntimeMemoryPressureLevel,
} from "../../runtime/memory-pressure.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "../../runtime/limit-context-recorder.js";
import type {
  OpsDelegationApprovalRequest,
  OpsDelegationQueueResponse,
  QueuedApproval,
  SpecialistWorker,
  WorkerBrokerPolicySnapshot,
  WorkerId,
  WorkerResult,
  WorkerStatusSnapshot,
  WorkerTaskEnvelope,
  WorkerTaskKind,
  WorkerTaskPriority,
  WorkerTaskSource,
} from "./types.js";

type WorkerTaskLane = WorkerTaskEnvelope["lane"];

interface QueuedApprovalInternal extends QueuedApproval {
  task: WorkerTaskEnvelope;
}

interface WorkerExecutionResult {
  result: WorkerResult;
  approval?: {
    summary: string;
    risk: "low" | "medium" | "high";
    task: WorkerTaskEnvelope;
  };
}

type ExecuteWorker = (
  worker: SpecialistWorker,
  task: WorkerTaskEnvelope,
) => Promise<WorkerExecutionResult>;

type BrokerOptions = {
  executeWorker: ExecuteWorker;
};

type WorkerRuntimeState = {
  running: boolean;
  lastRunAt: string | null;
  lastResult: WorkerResult | null;
};

type DispatchOptions = {
  depth?: number;
  parentWorkerId?: WorkerId | null;
  followHandoffs?: boolean;
};

const MAX_HANDOFF_DEPTH = 4;

function defaultWorkerForKind(kind: WorkerTaskKind): WorkerId {
  switch (kind) {
    case "telemetry-refresh":
      return "telemetry-ingest";
    case "ssa-review":
      return "ssa-analysis";
    case "source-adjustment":
      return "source-policy";
    case "command-request":
      return "command-planner";
    case "service-outage":
      return "service-reanimator";
    case "repair-batch":
      return "offline-repair";
    case "event-lesson":
      return "event-deposit";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function isWorkerEnabled(
  worker: SpecialistWorker,
  memory: { level: RuntimeMemoryPressureLevel },
): boolean {
  if (worker.id === "command-planner" && memory.level === "critical") {
    return false;
  }
  return true;
}

function statusState(
  worker: SpecialistWorker,
  runtime: WorkerRuntimeState,
  memory: { level: RuntimeMemoryPressureLevel },
): WorkerStatusSnapshot["state"] {
  if (!isWorkerEnabled(worker, memory)) {
    return "suspended";
  }
  if (runtime.running) {
    return "running";
  }
  if (
    runtime.lastResult?.status === "failed" ||
    runtime.lastResult?.status === "blocked"
  ) {
    return "degraded";
  }
  return "idle";
}

function deriveChildTask(
  parent: WorkerTaskEnvelope,
  next: WorkerResult["nextTasks"][number],
): WorkerTaskEnvelope {
  return {
    id: randomUUID(),
    createdAt: nowIso(),
    lane: next.lane ?? parent.lane,
    kind: next.kind ?? parent.kind,
    priority: next.priority ?? parent.priority,
    source: next.source ?? parent.source,
    actor: parent.actor,
    memory: parent.memory,
    payload: {
      ...parent.payload,
      ...(next.payload ?? {}),
    },
    relatedArtifacts: Array.from(
      new Set([...(parent.relatedArtifacts ?? []), ...(next.relatedArtifacts ?? [])]),
    ),
    requestedWorkerId: next.workerId,
    parentTaskId: parent.id,
  };
}

export function createWorkerTaskEnvelope(input: {
  lane: WorkerTaskLane;
  kind: WorkerTaskKind;
  priority?: WorkerTaskPriority;
  source?: WorkerTaskSource;
  actor?: { userId: string | null; role: "viewer" | "operator" | "admin" | null };
  payload?: Record<string, unknown>;
  relatedArtifacts?: string[];
  requestedWorkerId?: WorkerId | null;
  memory?: { level: RuntimeMemoryPressureLevel };
  parentTaskId?: string | null;
}): WorkerTaskEnvelope {
  const snapshot = getTrackedRuntimeMemoryPressureSnapshot("worker-broker", {
    operation: "dispatch",
  });
  return {
    id: randomUUID(),
    createdAt: nowIso(),
    lane: input.lane,
    kind: input.kind,
    priority: input.priority ?? "medium",
    source: input.source ?? (input.lane === "offline" ? "automation" : "runtime"),
    actor: input.actor ?? { userId: null, role: null },
    memory: input.memory ?? {
      level: snapshot.level,
    },
    payload: input.payload ?? {},
    relatedArtifacts: input.relatedArtifacts ?? [],
    requestedWorkerId: input.requestedWorkerId ?? null,
    parentTaskId: input.parentTaskId ?? null,
  };
}

export class WorkerMeshBroker {
  private readonly workers = new Map<WorkerId, SpecialistWorker>();
  private readonly runtime = new Map<WorkerId, WorkerRuntimeState>();
  private readonly executeWorker: ExecuteWorker;
  private readonly approvals: QueuedApprovalInternal[] = [];

  constructor(workers: SpecialistWorker[], options: BrokerOptions) {
    for (const worker of workers) {
      this.workers.set(worker.id, worker);
      this.runtime.set(worker.id, {
        running: false,
        lastRunAt: null,
        lastResult: null,
      });
    }
    this.executeWorker = options.executeWorker;
  }

  listWorkers(
    memory = getTrackedRuntimeMemoryPressureSnapshot("worker-broker", {
      operation: "list-workers",
    }),
  ): WorkerStatusSnapshot[] {
    return Array.from(this.workers.values()).map((worker) => {
      const runtime = this.runtime.get(worker.id) ?? {
        running: false,
        lastRunAt: null,
        lastResult: null,
      };
      return {
        id: worker.id,
        lane: worker.lane,
        enabled: isWorkerEnabled(worker, memory),
        approval: worker.approval,
        state: statusState(worker, runtime, memory),
        lastRunAt: runtime.lastRunAt,
        lastResult: runtime.lastResult,
      };
    });
  }

  getQueue(): OpsDelegationQueueResponse {
    return {
      pendingTasks: [],
      queuedApprovals: this.approvals.map(({ task, ...approval }) => approval),
    };
  }

  getPolicy(
    memory = getTrackedRuntimeMemoryPressureSnapshot("worker-broker", {
      operation: "get-policy",
    }),
  ): WorkerBrokerPolicySnapshot {
    return {
      memoryLevel: memory.level,
      autoSafeOps: true,
    };
  }

  async dispatch(
    task: WorkerTaskEnvelope,
    options: DispatchOptions = {},
  ): Promise<WorkerExecutionResult> {
    const workerId = task.requestedWorkerId ?? defaultWorkerForKind(task.kind);
    const worker = this.workers.get(workerId);
    if (!worker || !worker.canHandle(task)) {
      const blocked: WorkerResult = {
        workerId,
        status: "blocked",
        summary: "No eligible worker could handle this task.",
        autoExecuted: false,
        queuedApproval: false,
        touchedSystems: [],
        nextTasks: [],
        artifacts: [],
      };
      return { result: blocked };
    }

    if (options.parentWorkerId && options.parentWorkerId === worker.id) {
      const blocked: WorkerResult = {
        workerId: worker.id,
        status: "blocked",
        summary: "Worker recursion was blocked by broker policy.",
        autoExecuted: false,
        queuedApproval: false,
        touchedSystems: [],
        nextTasks: [],
        artifacts: [],
      };
      this.updateRuntime(worker.id, blocked);
      return { result: blocked };
    }

    if (!isWorkerEnabled(worker, task.memory)) {
      const blocked: WorkerResult = {
        workerId: worker.id,
        status: "blocked",
        summary: `${worker.id} is suspended by the RAM governor.`,
        autoExecuted: false,
        queuedApproval: false,
        touchedSystems: [],
        nextTasks: [],
        artifacts: [],
      };
      this.updateRuntime(worker.id, blocked);
      return { result: blocked };
    }

    if (
      worker.id === "command-planner" &&
      task.memory.level === "constrained" &&
      task.source !== "command-ui" &&
      task.source !== "offline-capsule" &&
      task.payload.manualRequested !== true
    ) {
      const deferred: WorkerResult = {
        workerId: worker.id,
        status: "deferred",
        summary: "Planner is manual-only while RAM is constrained.",
        autoExecuted: false,
        queuedApproval: false,
        touchedSystems: ["planner"],
        nextTasks: [],
        artifacts: [],
      };
      this.updateRuntime(worker.id, deferred);
      return { result: deferred };
    }

    this.markRunning(worker.id, true);
    const execution = await this.executeWorker(worker, task);
    this.markRunning(worker.id, false);
    this.updateRuntime(worker.id, execution.result);

    if (execution.approval) {
      const approval = execution.approval;
      const duplicate = this.approvals.find(
        (existing) =>
          existing.workerId ===
            (approval.task.requestedWorkerId ??
              defaultWorkerForKind(approval.task.kind)) &&
          existing.summary === approval.summary,
      );
      if (!duplicate) {
        this.approvals.unshift({
          taskId: approval.task.id,
          workerId:
            approval.task.requestedWorkerId ??
            defaultWorkerForKind(approval.task.kind),
          summary: approval.summary,
          risk: approval.risk,
          createdAt: nowIso(),
          task: approval.task,
        });
      }
      execution.result.queuedApproval = true;
    }

    if (
      options.followHandoffs !== false &&
      (options.depth ?? 0) < MAX_HANDOFF_DEPTH &&
      execution.result.nextTasks.length > 0
    ) {
      for (const next of execution.result.nextTasks) {
        if (next.workerId === worker.id) {
          continue;
        }
        const childTask = deriveChildTask(task, next);
        await this.dispatch(childTask, {
          depth: (options.depth ?? 0) + 1,
          parentWorkerId: worker.id,
          followHandoffs: true,
        });
      }
    }

    return execution;
  }

  async approve(
    request: OpsDelegationApprovalRequest,
  ): Promise<WorkerExecutionResult> {
    const index = this.approvals.findIndex((item) => item.taskId === request.taskId);
    if (index === -1) {
      return {
        result: {
          workerId: "command-planner",
          status: "blocked",
          summary: "Approval task not found.",
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: [],
          nextTasks: [],
          artifacts: [],
        },
      };
    }
    const [approval] = this.approvals.splice(index, 1);
    return this.dispatch(approval.task, { followHandoffs: true });
  }

  reject(request: OpsDelegationApprovalRequest): WorkerExecutionResult {
    const index = this.approvals.findIndex((item) => item.taskId === request.taskId);
    if (index === -1) {
      return {
        result: {
          workerId: "command-planner",
          status: "blocked",
          summary: "Approval task not found.",
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: [],
          nextTasks: [],
          artifacts: [],
        },
      };
    }
    const [approval] = this.approvals.splice(index, 1);
    const result: WorkerResult = {
      workerId: approval.workerId,
      status: "completed",
      summary: "Approval request rejected and removed from the queue.",
      autoExecuted: false,
      queuedApproval: false,
      touchedSystems: ["delegation-queue"],
      nextTasks: [],
      artifacts: [],
    };
    this.updateRuntime(approval.workerId, result);
    return { result };
  }

  private markRunning(workerId: WorkerId, running: boolean): void {
    const state = this.runtime.get(workerId);
    if (!state) {
      return;
    }
    state.running = running;
  }

  private updateRuntime(workerId: WorkerId, result: WorkerResult): void {
    const state = this.runtime.get(workerId);
    if (!state) {
      return;
    }
    state.lastRunAt = nowIso();
    state.lastResult = result;
  }
}
