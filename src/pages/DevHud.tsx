import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronRight,
  Cpu,
  Shield,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { OpsLaneLinks } from "@/components/ops/OpsLaneLinks";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import {
  approveOpsDelegationTask,
  dispatchOpsWorkerTask,
  executeModelSafeCommand,
  fetchOpsDelegationQueue,
  fetchOpsWorkers,
  fetchOpsCommandMetrics,
  planModelSafeCommand,
  queueOpsCommand,
  rejectOpsDelegationTask,
} from "@/lib/api/heliophysics-proxy";
import type {
  ModelSafeCommandPlanResponse,
  OpsCommandMetricsResponse,
} from "@/lib/types/space-weather";

type ObjectiveStatus = "complete" | "pending";

type Milestone = {
  id: string;
  title: string;
  objectives: Array<{
    name: string;
    status: ObjectiveStatus;
  }>;
};

type TerminalCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "workers" }
  | { kind: "approvals" }
  | { kind: "clear" }
  | { kind: "queue"; commandType: "log-health-check" | "trigger-nowcast" | "schedule-pass" }
  | { kind: "dispatch"; workerKind: string }
  | { kind: "approve"; taskId: string }
  | { kind: "reject"; taskId: string }
  | { kind: "restart-service" }
  | { kind: "plan-safe"; prompt: string }
  | { kind: "simulate-safe" }
  | { kind: "execute-safe" }
  | { kind: "unknown"; message: string };

const MILESTONES: Milestone[] = [
  {
    id: "V0.1",
    title: "KERNEL",
    objectives: [
      { name: "RAM_GUARD", status: "complete" },
      { name: "DATA_PARSER", status: "complete" },
    ],
  },
  {
    id: "V0.2",
    title: "INTEROP",
    objectives: [
      { name: "CCSDS_DECODER", status: "complete" },
      { name: "NASA_SURYA", status: "pending" },
    ],
  },
  {
    id: "V0.3",
    title: "CRYPTO",
    objectives: [
      { name: "QKD_GEN", status: "complete" },
      { name: "MORPH_MATCH", status: "complete" },
    ],
  },
  {
    id: "V0.5",
    title: "OPS",
    objectives: [
      { name: "SUPABASE_RLS", status: "complete" },
      { name: "FEEDBACK_API", status: "complete" },
    ],
  },
];

const LOG_CAP = 36;

function pushLogEntry(lines: string[], entry: string): string[] {
  return [entry, ...lines].slice(0, LOG_CAP);
}

function splitCommand(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

function parseTerminalCommand(raw: string): TerminalCommand {
  const [verb = "", ...rest] = splitCommand(raw);
  const prompt = rest.join(" ").trim();
  const normalizedRest = rest.join(" ").trim().toLowerCase();

  switch (verb.toLowerCase()) {
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "workers":
      return { kind: "workers" };
    case "approvals":
      return { kind: "approvals" };
    case "clear":
      return { kind: "clear" };
    case "log-health-check":
      return { kind: "queue", commandType: "log-health-check" };
    case "trigger-nowcast":
      return { kind: "queue", commandType: "trigger-nowcast" };
    case "schedule-pass":
      return { kind: "queue", commandType: "schedule-pass" };
    case "dispatch":
      return prompt
        ? { kind: "dispatch", workerKind: prompt }
        : { kind: "unknown", message: "dispatch requires a worker kind" };
    case "approve":
      return prompt
        ? { kind: "approve", taskId: prompt }
        : { kind: "unknown", message: "approve requires a task id" };
    case "reject":
      return prompt
        ? { kind: "reject", taskId: prompt }
        : { kind: "unknown", message: "reject requires a task id" };
    case "restart":
      return normalizedRest === "service"
        ? { kind: "restart-service" }
        : { kind: "unknown", message: "restart service is the supported restart command" };
    case "plan-safe":
      return prompt
        ? { kind: "plan-safe", prompt }
        : { kind: "unknown", message: "plan-safe requires a prompt" };
    case "simulate-safe":
      return { kind: "simulate-safe" };
    case "execute-safe":
      return { kind: "execute-safe" };
    default:
      return {
        kind: "unknown",
        message: verb
          ? `unknown command: ${verb}`
          : "enter a command or type help",
      };
  }
}

export default function DevHud() {
  const mission = useMissionSnapshot();
  const backendHealth = useBackendHealth();
  const [commandLine, setCommandLine] = useState("help");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    "[SYS] GAUSS_KERNEL_READY",
    "[SYS] BYPASS_CLOUD_ACTIVE",
  ]);
  const [auditState, setAuditState] = useState<"running" | "complete">("running");
  const [safePlan, setSafePlan] = useState<ModelSafeCommandPlanResponse | null>(null);
  const [metrics, setMetrics] = useState<OpsCommandMetricsResponse | null>(null);

  const completedObjectives = useMemo(
    () =>
      MILESTONES.reduce(
        (acc, milestone) => acc + milestone.objectives.filter((objective) => objective.status === "complete").length,
        0,
      ),
    [],
  );
  const totalObjectives = useMemo(
    () => MILESTONES.reduce((acc, milestone) => acc + milestone.objectives.length, 0),
    [],
  );
  const overallProgress = Math.round((completedObjectives / Math.max(1, totalObjectives)) * 100);

  const appendLog = (entry: string) => {
    setLogs((prev) => pushLogEntry(prev, entry));
  };

  useEffect(() => {
    const steps = [
      "[AUDIT] PROFILE_SYNC: constrained-device shell loaded",
      "[AUDIT] MEMORY_LANE: runtime scaler linked",
      "[AUDIT] ROUTE_SPLIT: subsystem aliases ready",
      "[AUDIT] TERMINAL_REDUNDANCY: operator TTY online",
      "[AUDIT] HUMAN_LOOP: approval gate armed",
      `[AUDIT] AUDIT_COMPLETE: ${overallProgress}% READINESS`,
    ];

    let index = 0;
    const timer = window.setInterval(() => {
      const next = steps[index];
      if (!next) {
        window.clearInterval(timer);
        setAuditState("complete");
        return;
      }
      appendLog(next);
      index += 1;
      if (index >= steps.length) {
        setAuditState("complete");
        window.clearInterval(timer);
      }
    }, 850);

    return () => window.clearInterval(timer);
  }, [overallProgress]);

  useEffect(() => {
    let active = true;

    const loadMetrics = async () => {
      try {
        const next = await fetchOpsCommandMetrics();
        if (active) {
          setMetrics(next);
        }
      } catch {
        if (active) {
          setMetrics(null);
        }
      }
    };

    void loadMetrics();
    const timer = window.setInterval(() => {
      void loadMetrics();
    }, 12_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleQueueCommand = async (
    commandType: "log-health-check" | "trigger-nowcast" | "schedule-pass",
  ) => {
    const response = await queueOpsCommand({
      command_type: commandType,
      execute: true,
      simulate: false,
      context: {
        origin: "dev-hud",
        lane: "terminal",
      },
    });
    const job = (response && typeof response === "object" && "job" in response) ? (response.job as { jobId: string }) : null;
    appendLog(
      `[OPS] ${commandType.toUpperCase()} ${job ? `queued:${job.jobId}` : "logged"}`,
    );
  };

  const handlePlanSafe = async (prompt: string) => {
    const response = await planModelSafeCommand({
      prompt,
      context: {
        origin: "dev-hud",
        lane: "terminal",
        operator_redundancy: true,
      },
    });
    setSafePlan(response);
    appendLog(`[SAFE] PLAN_READY ${response.proposal.commandPreview}`);
  };

  const handleExecuteSafe = async (simulate: boolean) => {
    if (!safePlan) {
      appendLog("[SAFE] No proposal available. Run plan-safe first.");
      return;
    }
    const response = await executeModelSafeCommand({
      approval_token: safePlan.approval?.token,
      plan: safePlan.proposal.plan as unknown as Record<string, unknown>,
      simulate,
    });
    appendLog(
      `[SAFE] ${simulate ? "SIM" : "EXEC"} ${response.execution.ok ? "OK" : "FAIL"} ${response.execution.commandPreview}`,
    );
  };

  const handleWorkers = async () => {
    const response = await fetchOpsWorkers();
    appendLog(
      `[WORKERS] ${response.workers.map((worker) => `${worker.id}:${worker.state}`).join(" | ")}`,
    );
  };

  const handleApprovals = async () => {
    const response = await fetchOpsDelegationQueue();
    appendLog(
      response.queuedApprovals.length > 0
        ? `[APPROVALS] ${response.queuedApprovals.map((approval) => `${approval.taskId}:${approval.risk}`).join(" | ")}`
        : "[APPROVALS] none pending",
    );
  };

  const handleDispatch = async (workerKind: string) => {
    const map: Record<string, { lane: "runtime" | "offline"; kind: string; workerId?: string; payload?: Record<string, unknown> }> = {
      "telemetry-ingest": { lane: "runtime", kind: "telemetry-refresh", workerId: "telemetry-ingest" },
      "ssa-analysis": { lane: "runtime", kind: "ssa-review", workerId: "ssa-analysis" },
      "source-policy": { lane: "runtime", kind: "source-adjustment", workerId: "source-policy" },
      "command-planner": {
        lane: "runtime",
        kind: "command-request",
        workerId: "command-planner",
        payload: {
          prompt: "Assess current command state for operator action.",
          manualRequested: true,
        },
      },
      "safe-executor": {
        lane: "runtime",
        kind: "command-request",
        workerId: "safe-executor",
        payload: {
          action: { kind: "log-health-check" },
        },
      },
      "service-reanimator": { lane: "offline", kind: "service-outage", workerId: "service-reanimator" },
      "offline-repair": { lane: "offline", kind: "repair-batch", workerId: "offline-repair" },
      "event-deposit": { lane: "offline", kind: "event-lesson", workerId: "event-deposit" },
    };

    const normalized = workerKind.trim().toLowerCase();
    const task = map[normalized];
    if (!task) {
      appendLog(`[ERR] unsupported worker: ${workerKind}`);
      return;
    }

    const response = await dispatchOpsWorkerTask({
      workerId: task.workerId,
      lane: task.lane,
      kind: task.kind,
      payload: task.payload,
    });
    appendLog(`[DISPATCH] ${normalized} ${response.result.status.toUpperCase()} ${response.result.summary}`);
  };

  const handleApprovalAction = async (taskId: string, approved: boolean) => {
    const response = approved
      ? await approveOpsDelegationTask({ taskId })
      : await rejectOpsDelegationTask({ taskId });
    appendLog(
      `[APPROVAL] ${approved ? "APPROVED" : "REJECTED"} ${taskId} ${response.result.summary}`,
    );
  };

  const handleTerminalSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const raw = commandLine.trim();
    if (!raw) {
      return;
    }
    appendLog(`> ${raw}`);
    setCommandLine("");

    const parsed = parseTerminalCommand(raw);
    if (parsed.kind === "clear") {
      setLogs([]);
      return;
    }
    if (parsed.kind === "help") {
      appendLog("[HELP] status | workers | approvals | dispatch <worker-kind>");
      appendLog("[HELP] approve <task-id> | reject <task-id> | restart service");
      appendLog("[HELP] log-health-check | trigger-nowcast | schedule-pass");
      appendLog("[HELP] plan-safe <prompt> | simulate-safe | execute-safe | clear");
      return;
    }
    if (parsed.kind === "status") {
      appendLog(
        `[STATUS] backend=${backendHealth.health?.ok ? "healthy" : "degraded"} memory=${backendHealth.memoryLevel} session=${mission.session?.authenticated ? mission.session.role ?? "viewer" : "signed-out"}`,
      );
      return;
    }
    if (parsed.kind === "workers") {
      setBusy(true);
      try {
        await handleWorkers();
      } catch (error) {
        appendLog(`[ERR] ${error instanceof Error ? error.message : "workers failed"}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (parsed.kind === "approvals") {
      setBusy(true);
      try {
        await handleApprovals();
      } catch (error) {
        appendLog(`[ERR] ${error instanceof Error ? error.message : "approvals failed"}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (parsed.kind === "unknown") {
      appendLog(`[ERR] ${parsed.message}`);
      return;
    }

    setBusy(true);
    try {
      if (parsed.kind === "queue") {
        await handleQueueCommand(parsed.commandType);
      } else if (parsed.kind === "dispatch") {
        await handleDispatch(parsed.workerKind);
      } else if (parsed.kind === "approve") {
        await handleApprovalAction(parsed.taskId, true);
      } else if (parsed.kind === "reject") {
        await handleApprovalAction(parsed.taskId, false);
      } else if (parsed.kind === "restart-service") {
        await handleDispatch("service-reanimator");
      } else if (parsed.kind === "plan-safe") {
        await handlePlanSafe(parsed.prompt);
      } else if (parsed.kind === "simulate-safe") {
        await handleExecuteSafe(true);
      } else if (parsed.kind === "execute-safe") {
        await handleExecuteSafe(false);
      }
    } catch (error) {
      appendLog(`[ERR] ${error instanceof Error ? error.message : "command failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-y-4 bg-[#050505] text-white" data-testid="dev-hud-page">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_420px]">
        <div className="space-y-4">
          <div className="rounded-[28px] border border-[#1d2800] bg-black p-5 shadow-[0_0_0_1px_rgba(204,255,0,0.08)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
                  Sovereign Intelligence v0.6
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">GAUSS AURORA</h1>
                <p className="mt-2 max-w-2xl text-sm text-white/68">
                  Terminal-style redundancy lane for operator-safe planning, simulation, and execution.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/40">
                    <Cpu className="h-3.5 w-3.5 text-[#CCFF00]" />
                    Node
                  </div>
                  <div className="mt-2 text-sm font-semibold">JUDITH_M1</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/40">
                    <Shield className="h-3.5 w-3.5 text-[#CCFF00]" />
                    Audit
                  </div>
                  <div data-testid="readiness-score" className="mt-2 font-mono text-sm font-semibold">
                    {overallProgress}%
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/40">
                    <Activity className="h-3.5 w-3.5 text-[#CCFF00]" />
                    Backend
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {backendHealth.health?.ok ? "LINKED" : "DEGRADED"}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/40">
                    <Zap className="h-3.5 w-3.5 text-[#CCFF00]" />
                    RAM
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {backendHealth.memoryLevel.toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            <span
              className="sr-only"
              aria-label={auditState === "running" ? "audit-running" : "audit-complete"}
            />
          </div>

          <div className="rounded-[28px] border border-[#1d2800] bg-black p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
                  Operator TTY
                </p>
                <p className="mt-1 text-sm text-white/68">
                  Command parser backed by ops queue and safe-command runner.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    appendLog("[OPS] NODE_SYNC_TRIGGERED");
                  }}
                  className="rounded-xl border border-[#294000] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#CCFF00] transition-colors hover:bg-[#101700]"
                >
                  Sync Node
                </button>
                <button
                  type="button"
                  onClick={() => {
                    appendLog("[OPS] SYSTEM_READY_CONFIRMED");
                  }}
                  className="rounded-xl border border-[#294000] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#CCFF00] transition-colors hover:bg-[#101700]"
                >
                  System Ready
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-[#020202] p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
                <TerminalSquare className="h-4 w-4 text-[#CCFF00]" />
                Terminal
              </div>

              <div
                className="max-h-[320px] overflow-y-auto rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-[12px] leading-6 text-[#CCFF00]"
                data-testid="audit-logs"
              >
                {logs.length === 0 ? (
                  <div className="text-white/28">[TTY] cleared</div>
                ) : (
                  logs.map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))
                )}
              </div>

              <form onSubmit={handleTerminalSubmit} className="mt-3 flex flex-col gap-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45" htmlFor="dev-hud-command">
                  Operator command
                </label>
                <div className="flex gap-2">
                  <input
                    id="dev-hud-command"
                    value={commandLine}
                    onChange={(event) => setCommandLine(event.target.value)}
                    placeholder="help"
                    className="flex-1 rounded-xl border border-[#294000] bg-black px-4 py-3 font-mono text-sm text-[#CCFF00] outline-none placeholder:text-[#7b8a42]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#CCFF00] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-black disabled:opacity-50"
                  >
                    Run
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <OpsLaneLinks compact showHub />
          <MissionSurfaceLinks compact />

          <div className="rounded-[28px] border border-[#1d2800] bg-black p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
              Safe command proposal
            </p>
            {safePlan ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#CCFF00]">
                    {safePlan.proposal.commandPreview}
                  </p>
                  <p className="mt-2 text-white/70">
                    {safePlan.proposal.plan.reason ?? "No model rationale provided."}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-white/50">
                    risk={safePlan.proposal.plan.risk} confidence={safePlan.proposal.plan.confidence ?? "n/a"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExecuteSafe(true)}
                    disabled={busy}
                    className="rounded-xl border border-[#294000] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#CCFF00] disabled:opacity-50"
                  >
                    Simulate safe
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExecuteSafe(false)}
                    disabled={busy}
                    className="rounded-xl border border-[#4f1f00] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#FF9A3C] disabled:opacity-50"
                  >
                    Execute safe
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/62">
                Use <code className="font-mono text-[#CCFF00]">plan-safe &lt;prompt&gt;</code> to request a reviewed local command.
              </p>
            )}
          </div>

          <div className="rounded-[28px] border border-[#1d2800] bg-black p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
              Operator ABI
            </p>
            <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#020202] p-4 font-mono text-[12px] text-[#CCFF00]">
{`typedef struct {
  const char* verb;
  const char* target;
  unsigned char simulate;
} gauss_operator_cmd;`}
            </pre>
            <div className="mt-3 space-y-2 font-mono text-[11px] text-white/62">
              <p>status</p>
              <p>log-health-check</p>
              <p>trigger-nowcast</p>
              <p>schedule-pass</p>
              <p>plan-safe audit backend memory scaler</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-[#1d2800] bg-black p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
              Runtime metrics
            </p>
            <div className="mt-3 space-y-2 text-sm text-white/72">
              <p>planner circuit: {metrics?.planner_circuit.open ? "open" : "closed"}</p>
              <p>queue depth: {metrics?.metrics.queue_depth ?? "n/a"}</p>
              <p>planner latency avg: {metrics?.metrics.planner_latency_avg_ms ?? "n/a"} ms</p>
              <p>memory level: {backendHealth.memoryLevel}</p>
              <p>session: {mission.session?.authenticated ? mission.session.role ?? "viewer" : "signed out"}</p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
