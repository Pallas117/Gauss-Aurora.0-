import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type IngestionRuntimeStatus,
  parseIngestionRuntimeMode,
} from "../../worker/runtime-controller.js";
import {
  getCanonicalFeed,
  getLatestCanonical,
  getSourceStatus,
  upsertSourceStatus,
} from "../../state.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "../../runtime/limit-context-recorder.js";
import { getSpaceDomainSnapshot } from "../../ssa/space-domain-store.js";
import { resolveSpaceDomainAvailability } from "../../ssa/availability.js";
import { buildSpaceDomainSummary } from "../../ssa/ssa-features.js";
import { getSpaceDomainAnalysis } from "../../ssa/live-analysis.js";
import { evaluateInferenceUrgency } from "../../ml-client/probability-gate.js";
import { generatePicoVizReport } from "../../services/pico-viz-service.js";
import type { SourceStatus } from "../../types.js";
import type {
  SpecialistWorker,
  WorkerResult,
  WorkerTaskEnvelope,
} from "./types.js";
import { WorkerMeshBroker, createWorkerTaskEnvelope } from "./broker.js";

type IngestionRuntimeLike = {
  getStatus: () => IngestionRuntimeStatus;
  setMode: (
    mode: IngestionRuntimeStatus["mode"],
    source?: string,
  ) => IngestionRuntimeStatus;
};

export type WorkerMeshDeps = {
  ingestionRuntime: IngestionRuntimeLike;
  offlineRepairCapsulePath?: string;
  offlineRepairArtifactsDir?: string;
  enqueueOpsCommandWithPersistence?: (input: {
    commandType: "trigger-nowcast" | "schedule-pass" | "log-health-check";
    payload: Record<string, unknown>;
    source: "manual" | "external-model";
    simulate: boolean;
    idempotencyKey?: string | null;
    requestedBy: string | null;
    heavyCommand: boolean;
    powerConstrained: boolean;
  }) => Promise<{ job: { jobId: string }; deduped: boolean }>;
};

type CommandAction =
  | { kind: "log-health-check" }
  | { kind: "service-restart"; service?: string | null }
  | {
      kind: "source-policy-adjustment";
      source: string;
      decision: "primary" | "validate" | "sample" | "suspend";
    }
  | { kind: "projection-cache-refresh" }
  | { kind: "offline-sync-install" };

type InternalExecution = {
  result: WorkerResult;
  approval?: {
    summary: string;
    risk: "low" | "medium" | "high";
    task: WorkerTaskEnvelope;
  };
};

function anomalyProbabilityFromSummary(summary: ReturnType<typeof buildSpaceDomainSummary>): number {
  const collisionLikelihood = Math.max(
    0,
    Math.min(1, (summary.conjunctionRisk.maxCollisionProbability ?? 0) * 100),
  );
  const learnedLaneLikelihood = Math.max(0, Math.min(1, summary.learnedLane.score));
  const crowdingLikelihood = Math.max(0, Math.min(1, summary.crowding.maxRiskScore));
  return Math.round(
    Math.max(
      0,
      Math.min(
        1,
        collisionLikelihood * 0.5 + learnedLaneLikelihood * 0.35 + crowdingLikelihood * 0.15,
      ),
    ) * 1000,
  ) / 1000;
}

function classifySourceDecision(
  entry: SourceStatus,
  level: WorkerTaskEnvelope["memory"]["level"],
): "primary" | "validate" | "sample" | "suspend" | null {
  if (level === "critical") {
    if (!entry.healthy) {
      return "suspend";
    }
    if ((entry.observedCostScore ?? 0) >= 0.6) {
      return "sample";
    }
  }
  if (level === "constrained") {
    if (!entry.healthy) {
      return "sample";
    }
    if ((entry.observedCostScore ?? 0) >= 0.75) {
      return "validate";
    }
  }
  return null;
}

function safeJsonPreview(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function runWorkspaceNodeScript(
  scriptPath: string,
  args: string[] = [],
  envExtra: Record<string, string> = {},
): {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    "node",
    ["--env-file-if-exists=.env", "--import", "tsx", scriptPath, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20 * 60 * 1000,
      env: {
        ...process.env,
        ...envExtra,
      },
    },
  );

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function summaryFromCommandAction(action: CommandAction): string {
  switch (action.kind) {
    case "log-health-check":
      return "Log a bounded health-check snapshot.";
    case "service-restart":
      return `Restart and recheck ${action.service ?? "Gauss local services"}.`;
    case "source-policy-adjustment":
      return `Apply ${action.decision} posture to ${action.source}.`;
    case "projection-cache-refresh":
      return "Refresh the deterministic projection cache.";
    case "offline-sync-install":
      return "Sync offline worker jobs into PicoClaw.";
  }
}

function extractPlannerAction(task: WorkerTaskEnvelope): CommandAction | null {
  const prompt = typeof task.payload.prompt === "string" ? task.payload.prompt.toLowerCase() : "";
  const hint =
    typeof task.payload.housekeepingHint === "string"
      ? task.payload.housekeepingHint.toLowerCase()
      : "";

  if (
    hint === "log-health-check" ||
    /health|diagnostic|status|log-health-check/.test(prompt)
  ) {
    return { kind: "log-health-check" };
  }
  if (hint === "service-restart" || /restart service|restart backend|recheck service/.test(prompt)) {
    return {
      kind: "service-restart",
      service:
        typeof task.payload.service === "string" ? task.payload.service : null,
    };
  }
  if (hint === "projection-cache-refresh" || /projection|cache refresh/.test(prompt)) {
    return { kind: "projection-cache-refresh" };
  }
  if (hint === "offline-sync-install" || /picoclaw|offline sync/.test(prompt)) {
    return { kind: "offline-sync-install" };
  }
  if (
    hint === "source-policy-adjustment" &&
    typeof task.payload.source === "string" &&
    typeof task.payload.decision === "string"
  ) {
    return {
      kind: "source-policy-adjustment",
      source: task.payload.source,
      decision: task.payload.decision as "primary" | "validate" | "sample" | "suspend",
    };
  }
  return null;
}

function selectMissionCommand(task: WorkerTaskEnvelope): {
  commandType: "trigger-nowcast" | "schedule-pass" | "log-health-check";
  payload: Record<string, unknown>;
} {
  const prompt = typeof task.payload.prompt === "string" ? task.payload.prompt.toLowerCase() : "";
  if (/schedule-pass|ground station|pass window/.test(prompt)) {
    return {
      commandType: "schedule-pass",
      payload: {
        rationale: task.payload.prompt,
        origin: "worker-mesh",
      },
    };
  }
  if (/ssa|anomaly|warning|critical|nowcast/.test(prompt)) {
    return {
      commandType: "trigger-nowcast",
      payload: {
        rationale: task.payload.prompt,
        anomalyProbability:
          typeof task.payload.anomalyProbability === "number"
            ? task.payload.anomalyProbability
            : null,
        origin: "worker-mesh",
      },
    };
  }
  return {
    commandType: "log-health-check",
    payload: {
      rationale: task.payload.prompt,
      origin: "worker-mesh",
    },
  };
}

function latestSourceStatus(): SourceStatus[] {
  return [...getSourceStatus()];
}

function createWorkers(deps: WorkerMeshDeps): SpecialistWorker[] {
  const telemetryIngest: SpecialistWorker = {
    id: "telemetry-ingest",
    lane: "runtime",
    actionClass: "observe",
    approval: "none",
    dependsOn: [],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "telemetry-ingest" || task.kind === "telemetry-refresh"),
    async execute(task) {
      const requestedMode = parseIngestionRuntimeMode(task.payload.mode);
      const status = requestedMode
        ? deps.ingestionRuntime.setMode(requestedMode, "worker:telemetry-ingest")
        : deps.ingestionRuntime.getStatus();
      const unhealthySources = latestSourceStatus().filter((entry) => !entry.healthy).length;
      const nextTasks: WorkerResult["nextTasks"] = [
        {
          workerId: "source-policy",
          kind: "source-adjustment",
          lane: "runtime",
          reason: "Refresh source posture after telemetry review.",
          payload: {
            sourceHealthChanged: unhealthySources > 0,
          },
        },
        {
          workerId: "ssa-analysis",
          kind: "ssa-review",
          lane: "runtime",
          reason: "Refresh SSA interpretation after telemetry cycle.",
          payload: {
            spaceDomainChanged: true,
          },
        },
      ];
      return {
        workerId: "telemetry-ingest",
        status: "completed",
        summary: `Telemetry ingest runtime is ${status.mode}.`,
        autoExecuted: task.source !== "command-ui",
        queuedApproval: false,
        touchedSystems: ["ingest-runtime"],
        nextTasks,
        artifacts: [],
        metrics: {
          running: status.running ? 1 : 0,
          unhealthySources,
          transitions: status.transitionCount,
        } as Record<string, number>,
      };
    },
  };

  const ssaAnalysis: SpecialistWorker = {
    id: "ssa-analysis",
    lane: "runtime",
    actionClass: "observe",
    approval: "none",
    dependsOn: ["telemetry-ingest"],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "ssa-analysis" || task.kind === "ssa-review"),
    async execute(task) {
      const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("worker-registry", {
        worker: "ssa-analysis",
      });
      const { snapshot, availability } = resolveSpaceDomainAvailability(
        getSpaceDomainSnapshot(),
        memorySnapshot,
      );
      const summary = buildSpaceDomainSummary(snapshot);
      const analysis = getSpaceDomainAnalysis(summary, {
        memorySnapshot,
        availability,
      });
      const anomalyProbability = anomalyProbabilityFromSummary(summary);
      const nextTasks: WorkerResult["nextTasks"] = [];
      if (anomalyProbability > 0.85) {
        nextTasks.push({
          workerId: "command-planner",
          kind: "command-request",
          lane: "runtime",
          reason: "SSA anomaly exceeded the deterministic gate.",
          payload: {
            prompt: `Review ${analysis.severity} SSA state and propose the next mission action.`,
            anomalyProbability,
            summary: analysis.summary,
            severity: analysis.severity,
            housekeepingHint: "log-health-check",
          },
          relatedArtifacts: [],
        });
      }
      return {
        workerId: "ssa-analysis",
        status: "completed",
        summary: analysis.headline,
        autoExecuted: task.source !== "command-ui",
        queuedApproval: false,
        touchedSystems: ["ssa", "space-domain", "public-summary"],
        nextTasks,
        artifacts: [],
        metrics: {
          anomalyProbability,
          learnedLaneScore: summary.learnedLane.score,
          conjunctionCount: summary.counts.conjunctionCount,
        } as Record<string, number>,
      };
    },
  };

  const sourcePolicy: SpecialistWorker = {
    id: "source-policy",
    lane: "runtime",
    actionClass: "housekeeping",
    approval: "safe-auto",
    dependsOn: ["telemetry-ingest"],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "source-policy" || task.kind === "source-adjustment"),
    async execute(task) {
      const statuses = latestSourceStatus();
      const touched: string[] = [];
      let changed = 0;

      for (const entry of statuses) {
        const explicitDecision =
          typeof task.payload.source === "string" &&
          task.payload.source === entry.source &&
          typeof task.payload.decision === "string"
            ? (task.payload.decision as "primary" | "validate" | "sample" | "suspend")
            : null;
        const decision = explicitDecision ?? classifySourceDecision(entry, task.memory.level);
        if (!decision || decision === entry.powerDecision) {
          continue;
        }
        upsertSourceStatus({
          ...entry,
          powerDecision: decision,
          policyReason: `worker:${task.memory.level}`,
        });
        changed += 1;
        touched.push(entry.source);
      }

      const unhealthySources = latestSourceStatus().filter((entry) => !entry.healthy);
      const nextTasks: WorkerResult["nextTasks"] = [];
      const significant = changed > 0 || task.memory.level === "critical";
      if (significant) {
        nextTasks.push({
          workerId: "command-planner",
          kind: "command-request",
          lane: "runtime",
          reason: "Source degradation crossed the operational significance threshold.",
          payload: {
            prompt: "Assess degraded source posture and propose the next safe operator action.",
            anomalyProbability: 0.88,
            housekeepingHint: changed > 0 ? "source-policy-adjustment" : "log-health-check",
            degradedSources: unhealthySources.map((entry) => entry.source),
          },
        });
      }

      return {
        workerId: "source-policy",
        status: "completed",
        summary:
          changed > 0
            ? `Source policy adjusted ${changed} source${changed === 1 ? "" : "s"} for ${task.memory.level} memory pressure.`
            : "Source policy held current posture.",
        autoExecuted: true,
        queuedApproval: false,
        touchedSystems: ["source-policy", ...touched],
        nextTasks,
        artifacts: [],
        metrics: {
          changed,
          unhealthySources: unhealthySources.length,
        } as Record<string, number>,
      };
    },
  };

  const commandPlanner: SpecialistWorker = {
    id: "command-planner",
    lane: "runtime",
    actionClass: "mission",
    approval: "operator-gate",
    dependsOn: ["ssa-analysis", "source-policy"],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "command-planner" || task.kind === "command-request"),
    async execute(task) {
      if (task.payload.missionApproved === true) {
        const missionCommand =
          task.payload.missionCommand &&
          typeof task.payload.missionCommand === "object" &&
          !Array.isArray(task.payload.missionCommand)
            ? (task.payload.missionCommand as {
                commandType: "trigger-nowcast" | "schedule-pass" | "log-health-check";
                payload: Record<string, unknown>;
              })
            : null;
        if (!missionCommand || !deps.enqueueOpsCommandWithPersistence) {
          return {
            workerId: "command-planner",
            status: "blocked",
            summary: "Approved mission action could not be queued.",
            autoExecuted: false,
            queuedApproval: false,
            touchedSystems: ["planner"],
            nextTasks: [],
            artifacts: [],
          };
        }
        const queued = await deps.enqueueOpsCommandWithPersistence({
          commandType: missionCommand.commandType,
          payload: missionCommand.payload,
          source: "external-model",
          simulate: false,
          idempotencyKey: `worker-${task.id}`,
          requestedBy: task.actor.userId,
          heavyCommand:
            missionCommand.commandType === "trigger-nowcast" ||
            missionCommand.commandType === "schedule-pass",
          powerConstrained: task.memory.level !== "nominal",
        });
        return {
          workerId: "command-planner",
          status: "completed",
          summary: `Approved mission action queued as ${missionCommand.commandType}.`,
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: ["planner", "ops-command-queue"],
          nextTasks: [],
          artifacts: [],
          metrics: {
            deduped: queued.deduped ? 1 : 0,
          } as Record<string, number>,
        };
      }

      const anomalyProbability =
        typeof task.payload.anomalyProbability === "number"
          ? task.payload.anomalyProbability
          : evaluateInferenceUrgency({
              horizonMinutes: 30,
              sequence: getCanonicalFeed().slice(-24),
              riskZones: getSpaceDomainSnapshot().riskZones?.riskZones ?? [],
            }).confidence / 100;

      if (anomalyProbability <= 0.85) {
        return {
          workerId: "command-planner",
          status: "deferred",
          summary: "Deterministic gate held the planner cold.",
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: ["planner"],
          nextTasks: [],
          artifacts: [],
          metrics: {
            anomalyProbability,
          } as Record<string, number>,
        };
      }

      const action = extractPlannerAction(task);
      if (action) {
        return {
          workerId: "command-planner",
          status: "completed",
          summary: `Planner promoted a housekeeping action: ${summaryFromCommandAction(action)}`,
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: ["planner"],
          nextTasks: [
            {
              workerId: "safe-executor",
              kind: "command-request",
              lane: "runtime",
              reason: "Housekeeping plan qualifies for safe auto-execution.",
              payload: {
                action,
              },
            },
          ],
          artifacts: [],
          metrics: {
            anomalyProbability,
          } as Record<string, number>,
        };
      }

      const missionCommand = selectMissionCommand(task);

      return {
        workerId: "command-planner",
        status: "deferred",
        summary:
          typeof task.payload.prompt === "string" && task.payload.prompt.trim().length > 0
            ? task.payload.prompt.trim().slice(0, 240)
            : "Planner generated a mission action proposal for operator approval.",
        autoExecuted: false,
        queuedApproval: true,
        touchedSystems: ["planner", "approval-queue"],
        nextTasks: [],
        artifacts: [],
        metrics: {
          anomalyProbability,
        } as Record<string, number>,
      };
    },
  };

  const safeExecutor: SpecialistWorker = {
    id: "safe-executor",
    lane: "runtime",
    actionClass: "housekeeping",
    approval: "safe-auto",
    dependsOn: ["command-planner"],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "safe-executor" || task.kind === "command-request"),
    async execute(task) {
      const action = task.payload.action as CommandAction | undefined;
      if (!action || typeof action !== "object" || !("kind" in action)) {
        return {
          workerId: "safe-executor",
          status: "blocked",
          summary: "Safe executor did not receive an allowlisted action.",
          autoExecuted: false,
          queuedApproval: false,
          touchedSystems: [],
          nextTasks: [],
          artifacts: [],
        };
      }

      switch (action.kind) {
        case "log-health-check": {
          const memory = getTrackedRuntimeMemoryPressureSnapshot("worker-registry", {
            worker: "command-planner",
          });
          return {
            workerId: "safe-executor",
            status: "completed",
            summary: `Health check captured at ${memory.freeMb} MB free RAM.`,
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["health", "runtime"],
            nextTasks: [],
            artifacts: [],
            metrics: {
              freeMb: memory.freeMb,
            } as Record<string, number>,
          };
        }
        case "service-restart": {
          const outcome = runWorkspaceNodeScript(
            "backend/scripts/offline-service-reanimator.ts",
          );
          return {
            workerId: "safe-executor",
            status: outcome.ok ? "completed" : "failed",
            summary: outcome.ok
              ? "Known local Gauss services were rechecked."
              : "Safe service restart failed.",
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["backend", "rag"],
            nextTasks: [],
            artifacts: [],
            metrics: {
              exitCode: outcome.exitCode ?? -1,
            } as Record<string, number>,
          };
        }
        case "source-policy-adjustment": {
          const status = latestSourceStatus().find((entry) => entry.source === action.source);
          if (!status) {
            return {
              workerId: "safe-executor",
              status: "blocked",
              summary: `Source ${action.source} was not found.`,
              autoExecuted: false,
              queuedApproval: false,
              touchedSystems: [],
              nextTasks: [],
              artifacts: [],
            };
          }
          upsertSourceStatus({
            ...status,
            powerDecision: action.decision,
            policyReason: "worker:safe-executor",
          });
          return {
            workerId: "safe-executor",
            status: "completed",
            summary: `${action.source} pinned to ${action.decision}.`,
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["source-policy", action.source],
            nextTasks: [],
            artifacts: [],
          };
        }
        case "projection-cache-refresh": {
          const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("worker-registry", {
            worker: "event-deposit",
          });
          resolveSpaceDomainAvailability(getSpaceDomainSnapshot(), memorySnapshot);
          return {
            workerId: "safe-executor",
            status: "completed",
            summary: "Projection availability cache refreshed.",
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["ssa", "projection-cache"],
            nextTasks: [],
            artifacts: [],
          };
        }
        case "offline-sync-install": {
          const outcome = runWorkspaceNodeScript(
            "backend/scripts/picoclaw-offline-sync.ts",
          );
          return {
            workerId: "safe-executor",
            status: outcome.ok ? "completed" : "failed",
            summary: outcome.ok
              ? "Offline worker jobs synced to PicoClaw."
              : "Offline worker sync failed.",
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["picoclaw"],
            nextTasks: [],
            artifacts: [],
            metrics: {
              exitCode: outcome.exitCode ?? -1,
            } as Record<string, number>,
          };
        }
        default: {
          return {
            workerId: "safe-executor",
            status: "blocked",
            summary: "Requested action is not on the safe housekeeping allowlist.",
            autoExecuted: false,
            queuedApproval: false,
            touchedSystems: [],
            nextTasks: [],
            artifacts: [],
          };
        }
      }
    },
  };

  const serviceReanimator: SpecialistWorker = {
    id: "service-reanimator",
    lane: "offline",
    actionClass: "housekeeping",
    approval: "safe-auto",
    dependsOn: [],
    canHandle: (task) =>
      task.lane === "offline" &&
      (task.requestedWorkerId === "service-reanimator" || task.kind === "service-outage"),
    async execute() {
      const outcome = runWorkspaceNodeScript(
        "backend/scripts/offline-service-reanimator.ts",
      );
      const reportPath = join(
        process.cwd(),
        "reports/monitoring/offline-service-reanimator.latest.json",
      );
      const report = safeJsonPreview(reportPath);
      const reportText = report ? JSON.parse(report) as { services?: Array<{ after?: boolean; attemptedStart?: boolean }> } : null;
      const failedRestarts = reportText?.services?.filter((service) => service.attemptedStart && !service.after).length ?? 0;
      return {
        workerId: "service-reanimator",
        status: outcome.ok ? "completed" : "failed",
        summary: outcome.ok
          ? "Offline reanimator checked the known local Gauss services."
          : "Offline reanimator reported a failed restart.",
        autoExecuted: true,
        queuedApproval: false,
        touchedSystems: ["backend", "rag"],
        nextTasks:
          failedRestarts > 0
            ? [
                {
                  workerId: "offline-repair",
                  kind: "repair-batch",
                  lane: "offline",
                  reason: "Recurring outage detected after safe restart attempts.",
                },
              ]
            : [],
        artifacts: reportPath && existsSync(reportPath) ? [reportPath] : [],
        metrics: {
          failedRestarts,
        } as Record<string, number>,
      };
    },
  };

  const offlineRepair: SpecialistWorker = {
    id: "offline-repair",
    lane: "offline",
    actionClass: "housekeeping",
    approval: "safe-auto",
    dependsOn: ["service-reanimator"],
    canHandle: (task) =>
      task.lane === "offline" &&
      (task.requestedWorkerId === "offline-repair" || task.kind === "repair-batch"),
    async execute() {
      const outcome = runWorkspaceNodeScript(
        "backend/scripts/offline-fetch-self-repair.ts",
      );
      const reportPath = join(
        process.cwd(),
        "reports/monitoring/offline-fetch-self-repair.latest.json",
      );
      return {
        workerId: "offline-repair",
        status: outcome.ok ? "completed" : "failed",
        summary: outcome.ok
          ? "Offline repair capsule and pairing were refreshed."
          : "Offline repair refresh failed.",
        autoExecuted: true,
        queuedApproval: false,
        touchedSystems: ["offline-repair", "orchestrator"],
        nextTasks: [],
        artifacts: existsSync(reportPath) ? [reportPath] : [],
        metrics: {
          exitCode: outcome.exitCode ?? -1,
        } as Record<string, number>,
      };
    },
  };

  const eventDeposit: SpecialistWorker = {
    id: "event-deposit",
    lane: "offline",
    actionClass: "housekeeping",
    approval: "safe-auto",
    dependsOn: [],
    canHandle: (task) =>
      task.lane === "offline" &&
      (task.requestedWorkerId === "event-deposit" || task.kind === "event-lesson"),
    async execute(task) {
      const disableModel =
        task.memory.level !== "nominal" && task.payload.manualRequested !== true;
      const outcome = runWorkspaceNodeScript(
        "backend/scripts/offline-event-deposit.ts",
        [],
        disableModel
          ? {
              ORCHESTRATOR_LOCAL_ENGINE_URL: "",
              GAUSS_BRAIN_URL: "",
            }
          : {},
      );
      const reportPath = join(
        process.cwd(),
        "reports/rag/offline-event-deposit.latest.json",
      );
      return {
        workerId: "event-deposit",
        status: outcome.ok ? "completed" : "failed",
        summary: disableModel
          ? "Event lessons were deposited using the deterministic path."
          : "Event lessons were deposited through the local lesson path.",
        autoExecuted: true,
        queuedApproval: false,
        touchedSystems: ["rag", "event-lessons"],
        nextTasks: [],
        artifacts: existsSync(reportPath) ? [reportPath] : [],
        metrics: {
          deterministicOnly: disableModel ? 1 : 0,
          exitCode: outcome.exitCode ?? -1,
        } as Record<string, number>,
      };
    },
  };

  const picoVizGenerator: SpecialistWorker = {
    id: "pico-viz-generator",
    lane: "runtime",
    actionClass: "observe",
    approval: "none",
    dependsOn: ["ssa-analysis"],
    canHandle: (task) =>
      task.lane === "runtime" &&
      (task.requestedWorkerId === "pico-viz-generator" || task.kind === "viz-refresh"),
    async execute() {
      const report = await generatePicoVizReport();
      const reportPath = join(
        process.cwd(),
        "reports/monitoring/picoclaw-viz.latest.json",
      );
      return {
        workerId: "pico-viz-generator",
        status: "completed",
        summary: "PicoClaw visualization report generated.",
        autoExecuted: true,
        queuedApproval: false,
        touchedSystems: ["picoclaw", "reporting"],
        nextTasks: [],
        artifacts: [reportPath],
        metrics: {
          contentLength: report.content.length,
          unhealthySources: (report.metadata.system as any)?.unhealthySources ?? 0,
        } as Record<string, number>,
      };
    },
  };

  return [
    telemetryIngest,
    ssaAnalysis,
    sourcePolicy,
    commandPlanner,
    safeExecutor,
    serviceReanimator,
    offlineRepair,
    eventDeposit,
    picoVizGenerator,
  ];
}

function executeWorkerResult(
  _deps: WorkerMeshDeps,
  worker: SpecialistWorker,
  task: WorkerTaskEnvelope,
): Promise<InternalExecution> {
  return worker.execute(task).then((result) => {
    if (worker.id !== "command-planner" || !result.queuedApproval) {
      return { result };
    }

    const approvalTask = createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "command-request",
      priority: task.priority,
      source: "command-ui",
      actor: task.actor,
      memory: task.memory,
      payload: {
        prompt:
          typeof task.payload.prompt === "string"
            ? task.payload.prompt
            : "Mission action approval requested.",
        missionApproved: true,
        missionCommand: selectMissionCommand(task),
      },
      relatedArtifacts: task.relatedArtifacts,
      requestedWorkerId: "command-planner",
      parentTaskId: task.id,
    });

    return {
      result,
      approval: {
        summary: result.summary,
        risk: result.metrics?.anomalyProbability && result.metrics.anomalyProbability > 0.9 ? "high" : "medium",
        task: approvalTask,
      },
    };
  });
}

export function createWorkerMeshBroker(deps: WorkerMeshDeps): WorkerMeshBroker {
  return new WorkerMeshBroker(createWorkers(deps), {
    executeWorker: (worker, task) => executeWorkerResult(deps, worker, task),
  });
}
