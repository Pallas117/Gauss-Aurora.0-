import { randomUUID } from "node:crypto";
import type { OpsCommandType } from "./deepseek-command-bridge.js";
import type { OpsCommandExecutionResult } from "./ops-command-executor.js";

export type OpsCommandJobStatus = "planned" | "running" | "succeeded" | "failed";
export type OpsCommandJobSource = "manual" | "deepseek";
export type PlannerProfileName = "performance" | "balanced" | "low-power";

export interface PlannerPowerState {
  batteryPercent: number | null;
  charging: boolean | null;
  powerSource: "ac" | "battery" | "unknown";
  thermalPressure: "nominal" | "high" | "critical";
  constrained: boolean;
  reason: string;
}

export interface PlannerModelProfile {
  profile: PlannerProfileName;
  model: string;
  maxTokens: number;
  temperature: number;
  reason: string;
}

export interface OpsCommandJobRecord {
  jobId: string;
  commandType: OpsCommandType;
  payload: Record<string, unknown>;
  source: OpsCommandJobSource;
  status: OpsCommandJobStatus;
  simulate: boolean;
  idempotencyKey: string | null;
  requestedBy: string | null;
  powerConstrained: boolean;
  heavyCommand: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: OpsCommandExecutionResult | null;
  error: string | null;
}

export interface OpsCommandRuntimeMetrics {
  enqueued_total: number;
  restored_total: number;
  deduped_total: number;
  execution_total: number;
  execution_succeeded_total: number;
  execution_failed_total: number;
  queue_depth: number;
  backpressure_wait_total: number;
  planner_requests_total: number;
  planner_failures_total: number;
  planner_parse_failures_total: number;
  planner_circuit_open_total: number;
  planner_latency_ms_total: number;
  planner_latency_samples: number;
  battery_throttle_hits_total: number;
  last_updated_at: string;
}

export interface PlannerMetricsEvent {
  latencyMs?: number;
  request?: boolean;
  failure?: boolean;
  parseFailure?: boolean;
  circuitOpen?: boolean;
  batteryThrottle?: boolean;
}

interface OpsCommandRuntimeOptions {
  maxJobs?: number;
  idempotencyTtlMs?: number;
  now?: () => Date;
}

export interface OpsCommandJobInput {
  commandType: OpsCommandType;
  payload: Record<string, unknown>;
  source: OpsCommandJobSource;
  simulate: boolean;
  idempotencyKey?: string | null;
  requestedBy?: string | null;
  powerConstrained?: boolean;
  heavyCommand?: boolean;
}

type ExecuteFn = (job: OpsCommandJobRecord) => Promise<OpsCommandExecutionResult>;

const DEFAULT_MAX_JOBS = 250;
const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function parseNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "charging"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "discharging"].includes(normalized)) return false;
  }
  return null;
}

function parsePowerSource(value: unknown): PlannerPowerState["powerSource"] {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("ac")) return "ac";
  if (normalized.includes("battery")) return "battery";
  return "unknown";
}

function parseThermal(value: unknown): PlannerPowerState["thermalPressure"] {
  if (typeof value !== "string") return "nominal";
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high" || normalized === "serious") return "high";
  return "nominal";
}

function clampInt(value: unknown, fallback: number, low: number, high: number): number {
  const num = parseNumber(value);
  if (num == null) return fallback;
  return Math.max(low, Math.min(high, Math.round(num)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function resolvePlannerPowerState(
  contextInput: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): PlannerPowerState {
  const contextPower =
    contextInput.power && typeof contextInput.power === "object" && !Array.isArray(contextInput.power)
      ? (contextInput.power as Record<string, unknown>)
      : {};

  const batteryPercent =
    parseNumber(contextPower.batteryPercent) ??
    parseNumber(contextPower.battery_percent) ??
    parseNumber(env.BATTERY_PERCENT);
  const charging =
    parseBool(contextPower.charging) ??
    parseBool(contextPower.isCharging) ??
    parseBool(env.BATTERY_CHARGING);
  const powerSource =
    parsePowerSource(contextPower.powerSource) !== "unknown"
      ? parsePowerSource(contextPower.powerSource)
      : parsePowerSource(env.BATTERY_POWER_SOURCE);
  const thermalPressure =
    parseThermal(contextPower.thermalPressure) !== "nominal"
      ? parseThermal(contextPower.thermalPressure)
      : parseThermal(env.ORCHESTRATOR_THERMAL_PRESSURE);

  const minSafeDischarging = clampInt(
    env.ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT,
    45,
    5,
    95,
  );

  const discharging = charging === false || (charging === null && powerSource === "battery");
  const lowBattery = batteryPercent != null && batteryPercent <= minSafeDischarging;
  const thermalConstrained = thermalPressure === "high" || thermalPressure === "critical";
  const constrained = thermalConstrained || (discharging && lowBattery);
  const reason = thermalConstrained
    ? `thermal=${thermalPressure}`
    : discharging && lowBattery
      ? `battery=${batteryPercent}% discharging<=${minSafeDischarging}%`
      : "nominal";

  return {
    batteryPercent: batteryPercent ?? null,
    charging,
    powerSource,
    thermalPressure,
    constrained,
    reason,
  };
}

export function resolvePlannerModelProfile(
  baseModel: string,
  powerState: PlannerPowerState,
  env: NodeJS.ProcessEnv = process.env,
): PlannerModelProfile {
  let profile: PlannerProfileName = "balanced";
  if (powerState.constrained) {
    profile = "low-power";
  } else if (powerState.charging === true && (powerState.batteryPercent ?? 0) >= 70) {
    profile = "performance";
  }

  const model =
    profile === "low-power"
      ? (env.ORCHESTRATOR_CHAT_MODEL_LOW_POWER ?? baseModel).trim()
      : profile === "performance"
        ? (env.ORCHESTRATOR_CHAT_MODEL_PERFORMANCE ?? baseModel).trim()
        : (env.ORCHESTRATOR_CHAT_MODEL_BALANCED ?? baseModel).trim();

  const maxTokens =
    profile === "low-power"
      ? clampInt(env.ORCHESTRATOR_CHAT_MAX_TOKENS_LOW_POWER, 180, 32, 2048)
      : profile === "performance"
        ? clampInt(env.ORCHESTRATOR_CHAT_MAX_TOKENS_PERFORMANCE, 420, 32, 4096)
        : clampInt(env.ORCHESTRATOR_CHAT_MAX_TOKENS_BALANCED, 300, 32, 4096);

  const temperature =
    profile === "low-power"
      ? 0.05
      : profile === "performance"
        ? 0.2
        : 0.1;

  return {
    profile,
    model: model || "local-model",
    maxTokens,
    temperature,
    reason: powerState.reason,
  };
}

export class OpsCommandRuntime {
  private readonly maxJobs: number;
  private readonly idempotencyTtlMs: number;
  private readonly nowFn: () => Date;
  private readonly executeFn: ExecuteFn;
  private readonly jobs = new Map<string, OpsCommandJobRecord>();
  private readonly orderedJobIds: string[] = [];
  private readonly idempotency = new Map<string, { jobId: string; createdAtMs: number }>();
  private readonly pending: string[] = [];
  private workerRunning = false;
  private heavyInFlight = false;
  private heavyWaiters: Array<() => void> = [];
  private metrics: OpsCommandRuntimeMetrics = {
    enqueued_total: 0,
    restored_total: 0,
    deduped_total: 0,
    execution_total: 0,
    execution_succeeded_total: 0,
    execution_failed_total: 0,
    queue_depth: 0,
    backpressure_wait_total: 0,
    planner_requests_total: 0,
    planner_failures_total: 0,
    planner_parse_failures_total: 0,
    planner_circuit_open_total: 0,
    planner_latency_ms_total: 0,
    planner_latency_samples: 0,
    battery_throttle_hits_total: 0,
    last_updated_at: new Date().toISOString(),
  };

  constructor(executeFn: ExecuteFn, options: OpsCommandRuntimeOptions = {}) {
    this.executeFn = executeFn;
    this.maxJobs = Math.max(50, options.maxJobs ?? DEFAULT_MAX_JOBS);
    this.idempotencyTtlMs = Math.max(10_000, options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS);
    this.nowFn = options.now ?? (() => new Date());
  }

  private markMetrics(): void {
    this.metrics.last_updated_at = this.nowFn().toISOString();
    this.metrics.queue_depth = this.pending.length;
  }

  notePlanner(event: PlannerMetricsEvent): void {
    if (event.request) this.metrics.planner_requests_total += 1;
    if (event.failure) this.metrics.planner_failures_total += 1;
    if (event.parseFailure) this.metrics.planner_parse_failures_total += 1;
    if (event.circuitOpen) this.metrics.planner_circuit_open_total += 1;
    if (event.batteryThrottle) this.metrics.battery_throttle_hits_total += 1;
    if (typeof event.latencyMs === "number" && Number.isFinite(event.latencyMs) && event.latencyMs >= 0) {
      this.metrics.planner_latency_ms_total += event.latencyMs;
      this.metrics.planner_latency_samples += 1;
    }
    this.markMetrics();
  }

  snapshotMetrics(): OpsCommandRuntimeMetrics & { planner_latency_avg_ms: number } {
    const avg = this.metrics.planner_latency_samples > 0
      ? this.metrics.planner_latency_ms_total / this.metrics.planner_latency_samples
      : 0;
    return {
      ...this.metrics,
      planner_latency_avg_ms: Number(avg.toFixed(2)),
    };
  }

  getJob(jobId: string): OpsCommandJobRecord | null {
    return this.jobs.get(jobId) ?? null;
  }

  listJobs(limit = 25): OpsCommandJobRecord[] {
    const max = Math.max(1, Math.min(limit, 250));
    return this.orderedJobIds
      .slice(Math.max(0, this.orderedJobIds.length - max))
      .reverse()
      .map((id) => this.jobs.get(id))
      .filter((job): job is OpsCommandJobRecord => Boolean(job));
  }

  private pruneIdempotency(nowMs: number): void {
    for (const [key, value] of this.idempotency.entries()) {
      if (nowMs - value.createdAtMs > this.idempotencyTtlMs || !this.jobs.has(value.jobId)) {
        this.idempotency.delete(key);
      }
    }
  }

  private trimJobs(): void {
    while (this.orderedJobIds.length > this.maxJobs) {
      const oldestId = this.orderedJobIds.shift();
      if (!oldestId) continue;
      this.jobs.delete(oldestId);
    }
  }

  enqueue(input: OpsCommandJobInput): { job: OpsCommandJobRecord; deduped: boolean } {
    const now = this.nowFn();
    const nowMs = now.getTime();
    this.pruneIdempotency(nowMs);

    const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 140)
      : null;

    if (idempotencyKey) {
      const existing = this.idempotency.get(idempotencyKey);
      if (existing) {
        const existingJob = this.jobs.get(existing.jobId);
        if (existingJob) {
          this.metrics.deduped_total += 1;
          this.markMetrics();
          return { job: existingJob, deduped: true };
        }
      }
    }

    const jobId = randomUUID();
    const isoNow = now.toISOString();
    const job: OpsCommandJobRecord = {
      jobId,
      commandType: input.commandType,
      payload: { ...input.payload },
      source: input.source,
      status: "planned",
      simulate: input.simulate,
      idempotencyKey,
      requestedBy: input.requestedBy ?? null,
      powerConstrained: Boolean(input.powerConstrained),
      heavyCommand: Boolean(input.heavyCommand),
      createdAt: isoNow,
      updatedAt: isoNow,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };

    this.jobs.set(jobId, job);
    this.orderedJobIds.push(jobId);
    if (idempotencyKey) {
      this.idempotency.set(idempotencyKey, { jobId, createdAtMs: nowMs });
    }
    this.pending.push(jobId);
    this.metrics.enqueued_total += 1;
    this.trimJobs();
    this.markMetrics();
    void this.process();
    return { job, deduped: false };
  }

  adoptPersistedJob(jobInput: OpsCommandJobRecord): OpsCommandJobRecord {
    const nowIso = this.nowFn().toISOString();
    const normalized: OpsCommandJobRecord = {
      jobId: jobInput.jobId,
      commandType: jobInput.commandType,
      payload: { ...jobInput.payload },
      source: jobInput.source,
      status: jobInput.status,
      simulate: Boolean(jobInput.simulate),
      idempotencyKey: jobInput.idempotencyKey?.trim() ? jobInput.idempotencyKey.trim().slice(0, 140) : null,
      requestedBy: jobInput.requestedBy ?? null,
      powerConstrained: Boolean(jobInput.powerConstrained),
      heavyCommand: Boolean(jobInput.heavyCommand),
      createdAt: jobInput.createdAt || nowIso,
      updatedAt: jobInput.updatedAt || nowIso,
      startedAt: jobInput.startedAt ?? null,
      completedAt: jobInput.completedAt ?? null,
      result: jobInput.result ?? null,
      error: jobInput.error ?? null,
    };

    const existing = this.jobs.get(normalized.jobId);
    if (existing) {
      this.jobs.set(normalized.jobId, normalized);
    } else {
      this.jobs.set(normalized.jobId, normalized);
      this.orderedJobIds.push(normalized.jobId);
    }

    if (normalized.idempotencyKey) {
      this.idempotency.set(normalized.idempotencyKey, {
        jobId: normalized.jobId,
        createdAtMs: Date.parse(normalized.createdAt) || Date.now(),
      });
    }

    if (normalized.status === "planned" && !this.pending.includes(normalized.jobId)) {
      this.pending.push(normalized.jobId);
      this.metrics.restored_total += 1;
      this.trimJobs();
      this.markMetrics();
      void this.process();
    } else {
      this.trimJobs();
      this.markMetrics();
    }

    return normalized;
  }

  private async withBackpressure<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    if (!enabled) {
      return fn();
    }
    if (this.heavyInFlight) {
      this.metrics.backpressure_wait_total += 1;
      this.markMetrics();
      await new Promise<void>((resolve) => {
        this.heavyWaiters.push(resolve);
      });
    }
    this.heavyInFlight = true;
    try {
      return await fn();
    } finally {
      this.heavyInFlight = false;
      const next = this.heavyWaiters.shift();
      if (next) next();
    }
  }

  private async process(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.pending.length > 0) {
        const jobId = this.pending.shift();
        if (!jobId) continue;
        const job = this.jobs.get(jobId);
        if (!job || job.status !== "planned") continue;

        job.status = "running";
        job.startedAt = this.nowFn().toISOString();
        job.updatedAt = job.startedAt;
        this.metrics.execution_total += 1;
        this.markMetrics();

        try {
          const result = await this.withBackpressure(
            job.heavyCommand && job.powerConstrained,
            async () => this.executeFn(job),
          );
          job.result = result;
          const completedAt = this.nowFn().toISOString();
          job.completedAt = completedAt;
          job.updatedAt = completedAt;
          if (result.executed) {
            job.status = "succeeded";
            this.metrics.execution_succeeded_total += 1;
          } else {
            job.status = "failed";
            job.error = result.detail;
            this.metrics.execution_failed_total += 1;
          }
          this.markMetrics();
        } catch (error) {
          const completedAt = this.nowFn().toISOString();
          job.completedAt = completedAt;
          job.updatedAt = completedAt;
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
          this.metrics.execution_failed_total += 1;
          this.markMetrics();
        }
      }
    } finally {
      this.workerRunning = false;
      this.markMetrics();
      if (this.pending.length > 0) {
        // Rare race where enqueue happened between loop exit and finally.
        await sleep(0);
        void this.process();
      }
    }
  }
}
