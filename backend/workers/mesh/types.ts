import type {
  RuntimeMemoryPressureLevel,
} from "../../runtime/memory-pressure.js";

export type WorkerId =
  | "telemetry-ingest"
  | "ssa-analysis"
  | "source-policy"
  | "command-planner"
  | "safe-executor"
  | "service-reanimator"
  | "offline-repair"
  | "event-deposit";

export type WorkerLane = "runtime" | "offline";
export type WorkerApprovalMode = "none" | "safe-auto" | "operator-gate";
export type WorkerActionClass = "observe" | "housekeeping" | "mission";
export type WorkerTaskKind =
  | "telemetry-refresh"
  | "ssa-review"
  | "source-adjustment"
  | "command-request"
  | "service-outage"
  | "repair-batch"
  | "event-lesson";
export type WorkerTaskPriority = "low" | "medium" | "high";
export type WorkerTaskSource =
  | "runtime"
  | "command-ui"
  | "automation"
  | "picoclaw"
  | "offline-capsule";

export interface WorkerTaskEnvelope {
  id: string;
  createdAt: string;
  lane: WorkerLane;
  kind: WorkerTaskKind;
  priority: WorkerTaskPriority;
  source: WorkerTaskSource;
  actor: {
    userId: string | null;
    role: "viewer" | "operator" | "admin" | null;
  };
  memory: {
    level: RuntimeMemoryPressureLevel;
  };
  payload: Record<string, unknown>;
  relatedArtifacts: string[];
  requestedWorkerId?: WorkerId | null;
  parentTaskId?: string | null;
}

export interface WorkerNextTask {
  workerId: WorkerId;
  reason: string;
  kind?: WorkerTaskKind;
  lane?: WorkerLane;
  priority?: WorkerTaskPriority;
  source?: WorkerTaskSource;
  payload?: Record<string, unknown>;
  relatedArtifacts?: string[];
}

export interface WorkerResult {
  workerId: WorkerId;
  status: "completed" | "deferred" | "blocked" | "failed";
  summary: string;
  autoExecuted: boolean;
  queuedApproval: boolean;
  touchedSystems: string[];
  nextTasks: WorkerNextTask[];
  artifacts: string[];
  metrics?: Record<string, number>;
}

export interface SpecialistWorker {
  id: WorkerId;
  lane: WorkerLane;
  actionClass: WorkerActionClass;
  approval: WorkerApprovalMode;
  dependsOn: WorkerId[];
  canHandle(task: WorkerTaskEnvelope): boolean;
  execute(task: WorkerTaskEnvelope): Promise<WorkerResult>;
}

export interface WorkerStatusSnapshot {
  id: WorkerId;
  lane: WorkerLane;
  enabled: boolean;
  approval: WorkerApprovalMode;
  state: "idle" | "running" | "degraded" | "suspended";
  lastRunAt: string | null;
  lastResult: WorkerResult | null;
}

export interface QueuedApproval {
  taskId: string;
  workerId: WorkerId;
  summary: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
}

export interface OpsDelegationQueueResponse {
  pendingTasks: Array<{
    taskId: string;
    workerId: WorkerId;
    summary: string;
    state: "queued" | "running";
    createdAt: string;
  }>;
  queuedApprovals: QueuedApproval[];
}

export interface OpsDelegationApprovalRequest {
  taskId: string;
}

export interface WorkerBrokerPolicySnapshot {
  memoryLevel: RuntimeMemoryPressureLevel;
  autoSafeOps: true;
}

