import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Response } from "express";
import express from "express";
import type { AuthenticatedRequest } from "../auth.js";
import {
  getCommandLogLatest,
  getCommandLogPool,
  getOpsCommandJob,
  insertCommandLog,
  listOpsCommandJobs,
  type CommandLogRow,
} from "../pg.js";
import {
  ALLOWED_OPS_COMMAND_TYPES,
  extractChatContent,
  extractFirstJsonObject,
  isOpsCommandType,
  normalizeChatCompletionsUrl,
  parseModelCommandPlan,
  type OpsCommandType,
} from "../model-command-bridge.js";
import {
  SafeCommandApprovalVault,
  buildSafeCommandProposal,
  parseSafeCommandPlan,
  resolveSafeCommandAllowlist,
  runSafeCommand,
  validateSafeCommandPlan,
  type SafeCommandPlan,
  type SafeCommandProposal,
} from "../safe-command-runner.js";
import {
  resolvePlannerModelProfile,
  resolvePlannerPowerState,
  type OpsCommandJobInput,
  type OpsCommandJobRecord,
  type OpsCommandRuntimeMetrics,
} from "../ops-command-runtime.js";
import { buildGovernedModelSystemPrompt } from "../ethics/model-governance.js";
import { buildPlannerTrendSummary } from "../planner-context.js";
import { getChatEngineUrl } from "../scripts/local-chat-engine-check.js";
import {
  getAuroraMap,
  getCanonicalFeed,
  getLatestCanonical,
  getLatestMms,
  getSourceStatus,
  setExogenousContext,
  getExogenousContext,
} from "../state.js";
import type { CanonicalSpaceWeatherPoint, DtnIslAuditStatus, SourceStatus } from "../types.js";
import { parseIngestionRuntimeMode, type IngestionRuntimeStatus } from "../worker/runtime-controller.js";
import {
  createWorkerMeshBroker,
} from "../workers/mesh/registry.js";
import { createWorkerTaskEnvelope } from "../workers/mesh/broker.js";
import type {
  WorkerId,
  WorkerLane,
  WorkerTaskKind,
  WorkerTaskPriority,
  WorkerTaskSource,
} from "../workers/mesh/types.js";
import {
  buildModelOrchestratorPairing,
  buildRepairPairingSummary,
  uniqueTargetsFromBatch,
  type OfflineRepairPairing,
  type OfflineRepairPairingSummary,
} from "../repair/offline-repair-pairing.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "../runtime/limit-context-recorder.js";
import { recordOperationalLimitContext } from "../runtime/limit-context-recorder.js";
import { filterByLookback, parseLookback } from "../utils.js";
import { kaliSupervisorReportPath, readKaliSupervisorReport } from "../ops/kali-supervisor.js";

type CanonicalFeedSource = "memory" | "supabase" | "influxdb";

type ThreatSummaryPayload = {
  gate: {
    action: string;
  };
  summary: {
    top_threat_type: string | null;
    top_threat_score: number | null;
    top_recommended_action: string | null;
    actionable_threat_count: number;
  };
};

type OpsCommandRuntimeLike = {
  notePlanner: (event: {
    latencyMs?: number;
    request?: boolean;
    failure?: boolean;
    parseFailure?: boolean;
    circuitOpen?: boolean;
    batteryThrottle?: boolean;
  }) => void;
  getJob: (jobId: string) => OpsCommandJobRecord | null;
  listJobs: (limit?: number) => OpsCommandJobRecord[];
  snapshotMetrics: () => OpsCommandRuntimeMetrics;
  adoptPersistedJob: (job: OpsCommandJobRecord) => void;
};

type IngestionRuntimeLike = {
  getStatus: () => IngestionRuntimeStatus;
  setMode: (mode: IngestionRuntimeStatus["mode"], source?: string) => IngestionRuntimeStatus;
};

export type OpsControlMountDeps = {
  requireRole: (role: "operator" | "admin") => any;
  requireClearance: (level: "public" | "mission" | "restricted") => any;
  withAsyncMiddleware: (
    fn: (req: AuthenticatedRequest, res: Response, next: express.NextFunction) => Promise<void>,
  ) => any;
  opsCommandRuntime: OpsCommandRuntimeLike;
  ingestionRuntime: IngestionRuntimeLike;
  opsPersistenceEnabled: boolean;
  enqueueOpsCommandWithPersistence: (
    input: OpsCommandJobInput,
  ) => Promise<{ job: OpsCommandJobRecord; deduped: boolean }>;
  hydratePersistedSourceHealthState: () => Promise<SourceStatus[]>;
  buildThreatSummaryPayload: (
    sequence: CanonicalSpaceWeatherPoint[],
    lookbackMs: number,
    source: CanonicalFeedSource,
    horizonMinutes: number,
  ) => ThreatSummaryPayload;
  loadDtnIslStatus: () => Promise<DtnIslAuditStatus>;
  getLastTriadReport: () => Record<string, unknown> | null;
  offlineRepairCapsulePath?: string;
  offlineRepairArtifactsDir?: string;
};

type PlannerCircuitState = {
  consecutiveFailures: number;
  openUntilMs: number;
};

type OfflineRepairFinding = {
  id?: string;
  severity?: string;
  category?: string;
  title?: string;
  target?: string | null;
  evidence?: string;
  recommendation?: string;
  offlineFixable?: boolean;
};

type OfflineRepairBatch = {
  batchId: string;
  goal: string;
  rationale: string;
  maxFilesChanged: number;
  maxChangedLines: number;
  allowedActions: string[];
  blockedActions: string[];
  validatorSequence: string[];
  items: OfflineRepairFinding[];
  pairing?: OfflineRepairPairing;
};

type OfflineRepairCapsule = {
  generated_at: string;
  root: string;
  profile: {
    offline_required?: boolean;
    air_gap?: boolean;
    strict_local_inference?: boolean;
    local_engine_url?: string | null;
    model_endpoint_mode?: string;
    ingest_power_profile?: string;
    power_save_mode?: boolean;
    battery_percent?: number | null;
    charging?: boolean | null;
    min_safe_battery_percent?: number;
  };
  system_flow?: Array<{
    stage?: string;
    purpose?: string;
    inputs?: string[];
    outputs?: string[];
    guardrails?: string[];
  }>;
  prompt_contract?: {
    role?: string;
    instructions?: string[];
    required_output?: string[];
    validator_policy?: string[];
  };
  pairing_summary?: OfflineRepairPairingSummary;
  repair_batches: OfflineRepairBatch[];
};

type OfflineRepairProposal = {
  risk: "low" | "medium" | "high";
  summary: string;
  touched_files: string[];
  validation_plan: string[];
  unified_diff: string;
  scope_reason: string;
};

type ValidatorResult = {
  command: string;
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

type OfflineRepairArtifact = {
  generated_at: string;
  capsule_generated_at: string;
  batch: OfflineRepairBatch;
  pairing: OfflineRepairPairing;
  planner: {
    mode: "external-model" | "deterministic-fallback";
    model: string;
    profile: string;
    reason: string;
    chat_url: string | null;
    latency_ms: number | null;
    fallback_reason: string | null;
  };
  proposal: OfflineRepairProposal;
  validation: {
    scope: "workspace-baseline";
    requested: boolean;
    sequence: string[];
    passed: boolean;
    failed_command: string | null;
    results: ValidatorResult[];
  };
};

type ValidatorSpec = {
  command: string;
  args: string[];
  timeoutMs: number;
};

const REQUIREMENTS_AUDIT_JSON = "reports/progress/requirements-audit.latest.json";
const DEFAULT_OFFLINE_REPAIR_CAPSULE_PATH = "reports/orchestrator/offline-repair-capsule.latest.json";
const DEFAULT_OFFLINE_REPAIR_ARTIFACTS_DIR = "reports/orchestrator/repair-patches";
const MAX_VALIDATOR_OUTPUT_BYTES = 24_000;
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
const WORKER_TASK_KINDS = new Set<WorkerTaskKind>([
  "telemetry-refresh",
  "ssa-review",
  "source-adjustment",
  "command-request",
  "service-outage",
  "repair-batch",
  "event-lesson",
]);
const WORKER_TASK_PRIORITIES = new Set<WorkerTaskPriority>(["low", "medium", "high"]);
const WORKER_TASK_SOURCES = new Set<WorkerTaskSource>([
  "runtime",
  "command-ui",
  "automation",
  "picoclaw",
  "offline-capsule",
]);

function resolveWorkspacePath(input: string | undefined, fallback: string): string {
  const candidate = input?.trim();
  if (!candidate) {
    return join(process.cwd(), fallback);
  }
  return candidate.startsWith("/") ? candidate : join(process.cwd(), candidate);
}

function parseWorkerId(value: unknown): WorkerId | null {
  return typeof value === "string" && WORKER_IDS.has(value as WorkerId)
    ? (value as WorkerId)
    : null;
}

function parseWorkerLane(value: unknown): WorkerLane | null {
  return typeof value === "string" && WORKER_LANES.has(value as WorkerLane)
    ? (value as WorkerLane)
    : null;
}

function parseWorkerTaskKind(value: unknown): WorkerTaskKind | null {
  return typeof value === "string" && WORKER_TASK_KINDS.has(value as WorkerTaskKind)
    ? (value as WorkerTaskKind)
    : null;
}

function parseWorkerTaskPriority(value: unknown): WorkerTaskPriority | null {
  return typeof value === "string" && WORKER_TASK_PRIORITIES.has(value as WorkerTaskPriority)
    ? (value as WorkerTaskPriority)
    : null;
}

function parseWorkerTaskSource(value: unknown): WorkerTaskSource | null {
  return typeof value === "string" && WORKER_TASK_SOURCES.has(value as WorkerTaskSource)
    ? (value as WorkerTaskSource)
    : null;
}

function featuresForRole(role: string | null | undefined): {
  heliophysics: boolean;
  debris: boolean;
} {
  if (role === "operator" || role === "admin") {
    return { heliophysics: true, debris: true };
  }
  if (role === "viewer") {
    return { heliophysics: true, debris: false };
  }
  return { heliophysics: false, debris: false };
}

function parseEnvBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasMissionClearance(clearance: string | null | undefined): boolean {
  return clearance === "mission" || clearance === "restricted";
}

function commandNeedsMissionClearance(commandType: OpsCommandType): boolean {
  return commandType !== "log-health-check";
}

function resolveLocalEngineChatUrl(): string | null {
  const base = getChatEngineUrl();
  if (!base) return null;
  return normalizeChatCompletionsUrl(base);
}

function resolveLocalEngineApiKey(): string | null {
  const key = (process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY ?? process.env.EXTERNAL_MODEL_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

function parseRequestBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
    if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  }
  return fallback;
}

function parseRequestNumber(value: unknown, fallback: number, low: number, high: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(low, Math.min(high, num));
}

function parseIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 140);
}

function isSafeCommandRunnerEnabled(): boolean {
  return parseEnvBool("ORCHESTRATOR_SAFE_COMMAND_RUNNER_ENABLED", false);
}

function safeCommandRequireApproval(): boolean {
  return parseEnvBool("ORCHESTRATOR_SAFE_COMMAND_REQUIRE_APPROVAL", true);
}

function safeCommandPlannerFallbackEnabled(): boolean {
  return parseEnvBool("ORCHESTRATOR_SAFE_COMMAND_PLANNER_FALLBACK_ENABLED", true);
}

function safeCommandTimeoutMs(): number {
  return Math.max(1_000, Math.min(parseEnvInt("ORCHESTRATOR_SAFE_COMMAND_TIMEOUT_MS", 12_000), 60_000));
}

function safeCommandMaxOutputBytes(): number {
  return Math.max(1_024, Math.min(parseEnvInt("ORCHESTRATOR_SAFE_COMMAND_MAX_OUTPUT_BYTES", 32_768), 131_072));
}

function safeCommandApprovalTtlMs(): number {
  return Math.max(5_000, Math.min(parseEnvInt("ORCHESTRATOR_SAFE_COMMAND_APPROVAL_TTL_MS", 5 * 60 * 1000), 30 * 60 * 1000));
}

function safeCommandAllowlistPreview(limit = 24): string[] {
  const allowlist = resolveSafeCommandAllowlist(process.env);
  return Array.from(allowlist).sort().slice(0, limit);
}

function safeCommandAuditSoftFailEnabled(): boolean {
  return parseEnvBool("ORCHESTRATOR_SAFE_COMMAND_AUDIT_SOFT_FAIL", false);
}

function buildSoftAuditLog(entry: {
  command_type: string;
  payload?: Record<string, unknown>;
  role?: string | null;
  user_id?: string | null;
}): CommandLogRow {
  return {
    id: -Date.now(),
    created_at: new Date(),
    command_type: entry.command_type,
    payload: {
      ...(entry.payload ?? {}),
      audit_soft_fail: true,
      audit_storage: "memory-fallback",
    },
    role: entry.role ?? null,
    user_id: entry.user_id ?? null,
  };
}

async function insertSafeCommandAuditLog(entry: {
  command_type: string;
  payload?: Record<string, unknown>;
  role?: string | null;
  user_id?: string | null;
}): Promise<{ log: CommandLogRow; persisted: boolean } | null> {
  const persisted = await insertCommandLog(entry);
  if (persisted) {
    return {
      log: persisted,
      persisted: true,
    };
  }
  if (!safeCommandAuditSoftFailEnabled()) {
    return null;
  }
  console.warn(
    `[ops-command] audit soft-fail active: using memory fallback for ${entry.command_type}`,
  );
  return {
    log: buildSoftAuditLog(entry),
    persisted: false,
  };
}

function buildFallbackSafeCommandPlan(prompt: string, allowlist: Set<string>): SafeCommandPlan {
  const lower = prompt.toLowerCase();
  if (allowlist.has("uptime") && /(uptime|load|cpu|performance)/.test(lower)) {
    return {
      executable: "uptime",
      args: [],
      reason: "Fallback planner selected uptime for runtime diagnostics.",
      confidence: 0.35,
      risk: "low",
    };
  }
  if (allowlist.has("vm_stat") && /(memory|ram|swap)/.test(lower)) {
    return {
      executable: "vm_stat",
      args: [],
      reason: "Fallback planner selected vm_stat for memory diagnostics.",
      confidence: 0.35,
      risk: "low",
    };
  }
  if (allowlist.has("df") && /(disk|storage|volume|space)/.test(lower)) {
    return {
      executable: "df",
      args: ["-h"],
      reason: "Fallback planner selected df for storage diagnostics.",
      confidence: 0.35,
      risk: "low",
    };
  }
  if (allowlist.has("pmset")) {
    return {
      executable: "pmset",
      args: ["-g", "batt"],
      reason: "Fallback planner selected pmset for battery diagnostics.",
      confidence: 0.35,
      risk: "low",
    };
  }
  const first = Array.from(allowlist)[0] ?? "uptime";
  return {
    executable: first,
    args: [],
    reason: "Fallback planner selected first allowlisted executable.",
    confidence: 0.2,
    risk: "low",
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function requestPlannerWithRetry(
  chatUrl: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ status: number; rawText: string; latencyMs: number }> {
  const retries = Math.max(0, Math.round(parseRequestNumber(process.env.ORCHESTRATOR_PLANNER_RETRIES, 2, 0, 6)));
  const retryDelayMs = Math.max(
    50,
    Math.round(parseRequestNumber(process.env.ORCHESTRATOR_PLANNER_RETRY_DELAY_MS, 250, 50, 5_000)),
  );
  const timeoutMs = Math.max(
    2_000,
    Math.round(parseRequestNumber(process.env.ORCHESTRATOR_PLANNER_TIMEOUT_MS, 30_000, 2_000, 120_000)),
  );

  const startMs = Date.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const rawText = await response.text();
      if (!response.ok && isRetriableStatus(response.status) && attempt < retries) {
        await sleepMs(retryDelayMs * (attempt + 1));
        continue;
      }
      return {
        status: response.status,
        rawText,
        latencyMs: Date.now() - startMs,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleepMs(retryDelayMs * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Planner request failed");
}

function isHeavyCommand(commandType: OpsCommandType): boolean {
  return commandType === "trigger-nowcast" || commandType === "schedule-pass";
}

function buildPolicyReason(input: {
  commandType: OpsCommandType;
  execute: boolean;
  simulate: boolean;
  powerProfile: string;
  constrained: boolean;
}): string {
  const roleRule = commandNeedsMissionClearance(input.commandType)
    ? "mission-clearance-required"
    : "operator-safe";
  const modeRule = input.simulate
    ? "simulate-only"
    : input.execute
      ? "execute-approved"
      : "plan-only";
  const powerRule = input.constrained ? `power-constrained:${input.powerProfile}` : `power-nominal:${input.powerProfile}`;
  return `${roleRule};${modeRule};${powerRule}`;
}


function readRequirementsAuditSummary(root = process.cwd()): {
  generated_at: string | null;
  totals: { pass: number; warn: number; fail: number; skip: number } | null;
  check_count: number;
  message?: string;
  error?: string;
} {
  const filePath = join(root, REQUIREMENTS_AUDIT_JSON);
  if (!existsSync(filePath)) {
    return {
      generated_at: null,
      totals: null,
      check_count: 0,
      message: "No audit recorded yet. Run npm run audit:adherence:record.",
    };
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as {
      generated_at?: string;
      totals?: { pass: number; warn: number; fail: number; skip: number };
      checks?: unknown[];
    };
    return {
      generated_at: payload.generated_at ?? null,
      totals: payload.totals ?? null,
      check_count: payload.checks?.length ?? 0,
    };
  } catch (error) {
    return {
      generated_at: null,
      totals: null,
      check_count: 0,
      message: "Failed to read audit report.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readOfflineRepairCapsule(capsulePath: string): OfflineRepairCapsule | null {
  if (!existsSync(capsulePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(capsulePath, "utf8")) as OfflineRepairCapsule;
  } catch {
    return null;
  }
}

function selectOfflineRepairBatch(
  capsule: OfflineRepairCapsule,
  requestedBatchId: string | null,
): OfflineRepairBatch | null {
  if (!Array.isArray(capsule.repair_batches) || capsule.repair_batches.length === 0) {
    return null;
  }
  if (!requestedBatchId) {
    return capsule.repair_batches[0] ?? null;
  }
  return capsule.repair_batches.find((batch) => batch.batchId === requestedBatchId) ?? null;
}

function normalizeRelativeTarget(target: string | null | undefined): string | null {
  if (typeof target !== "string") {
    return null;
  }
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith("..") || trimmed.includes("\\")) {
    return null;
  }
  return trimmed.replace(/^\.\//, "");
}

function resolveBatchPairing(batch: OfflineRepairBatch): OfflineRepairPairing {
  return batch.pairing ?? buildModelOrchestratorPairing(batch);
}

function resolvePairingSummary(capsule: OfflineRepairCapsule): OfflineRepairPairingSummary {
  if (capsule.pairing_summary) {
    return capsule.pairing_summary;
  }
  return buildRepairPairingSummary(capsule.repair_batches ?? []);
}

function readTargetPreview(root: string, target: string, maxChars = 12_000): { file: string; preview: string } | null {
  const absolute = join(root, target);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    const raw = readFileSync(absolute, "utf8");
    if (raw.length <= maxChars) {
      return { file: target, preview: raw };
    }
    const head = raw.slice(0, Math.floor(maxChars / 2));
    const tail = raw.slice(-Math.floor(maxChars / 2));
    return {
      file: target,
      preview: `${head}\n/* ... truncated ${raw.length - maxChars} chars ... */\n${tail}`,
    };
  } catch {
    return null;
  }
}

function riskFromBatch(batch: OfflineRepairBatch): OfflineRepairProposal["risk"] {
  if (batch.items.some((item) => item.severity === "P1")) {
    return "medium";
  }
  if (batch.items.some((item) => item.severity === "P2")) {
    return "low";
  }
  return "low";
}

function buildFallbackOfflineRepairProposal(batch: OfflineRepairBatch, reason: string): OfflineRepairProposal {
  const touchedFiles = uniqueTargetsFromBatch(batch);
  return {
    risk: riskFromBatch(batch),
    summary: `Proposal-only fallback for ${batch.batchId}: ${batch.goal}`,
    touched_files: touchedFiles,
    validation_plan: batch.validatorSequence,
    unified_diff: "",
    scope_reason: `${reason} Keep edits inside ${touchedFiles.join(", ") || "the bounded batch scope"}.`,
  };
}

function parseOfflineRepairProposal(
  input: string | Record<string, unknown>,
  allowedTargets: string[],
  fallbackValidationPlan: string[],
): OfflineRepairProposal | null {
  let parsed: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    const candidate = trimmed.startsWith("{") ? trimmed : extractFirstJsonObject(trimmed);
    if (!candidate) {
      return null;
    }
    try {
      parsed = JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    parsed = input;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 800) : "";
  const scopeReason = typeof parsed.scope_reason === "string" ? parsed.scope_reason.trim().slice(0, 800) : "";
  if (!summary || !scopeReason) {
    return null;
  }

  const riskRaw = typeof parsed.risk === "string" ? parsed.risk.trim().toLowerCase() : "low";
  const risk = riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";

  const touchedFiles = Array.isArray(parsed.touched_files)
    ? parsed.touched_files
      .map((value) => normalizeRelativeTarget(typeof value === "string" ? value : null))
      .filter((value): value is string => value !== null && allowedTargets.includes(value))
    : [];
  if (touchedFiles.length === 0) {
    return null;
  }

  const validationPlan = Array.isArray(parsed.validation_plan)
    ? parsed.validation_plan
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => fallbackValidationPlan.includes(value))
    : [];
  const unifiedDiff = typeof parsed.unified_diff === "string" ? parsed.unified_diff.slice(0, 60_000) : "";

  return {
    risk,
    summary,
    touched_files: touchedFiles,
    validation_plan: validationPlan.length > 0 ? validationPlan : fallbackValidationPlan,
    unified_diff: unifiedDiff,
    scope_reason: scopeReason,
  };
}

function resolveValidatorSpec(command: string): ValidatorSpec | null {
  const normalized = command.trim();
  if (normalized === "npm run -s lint") {
    return { command: "npm", args: ["run", "-s", "lint"], timeoutMs: 120_000 };
  }
  if (normalized === "npm test") {
    return { command: "npm", args: ["test"], timeoutMs: 180_000 };
  }
  if (normalized === "npm run -s build") {
    return { command: "npm", args: ["run", "-s", "build"], timeoutMs: 180_000 };
  }
  if (normalized === "npm run -s test:unit:ui") {
    return { command: "npm", args: ["run", "-s", "test:unit:ui"], timeoutMs: 180_000 };
  }
  return null;
}

function appendBoundedOutput(current: string, chunk: Buffer, maxBytes: number): { next: string; truncated: boolean } {
  if (Buffer.byteLength(current) >= maxBytes) {
    return { next: current, truncated: true };
  }
  const remaining = maxBytes - Buffer.byteLength(current);
  const rendered = chunk.toString("utf8");
  if (Buffer.byteLength(rendered) <= remaining) {
    return { next: current + rendered, truncated: false };
  }
  return {
    next: current + rendered.slice(0, remaining),
    truncated: true,
  };
}

async function runValidatorCommand(command: string): Promise<ValidatorResult> {
  const spec = resolveValidatorSpec(command);
  if (!spec) {
    return {
      command,
      ok: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: 0,
      stdout: "",
      stderr: "Validator command is not on the offline allowlist.",
      truncated: false,
    };
  }

  const startedAt = Date.now();
  return new Promise<ValidatorResult>((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, spec.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const next = appendBoundedOutput(stdout, chunk, MAX_VALIDATOR_OUTPUT_BYTES);
      stdout = next.next;
      truncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = appendBoundedOutput(stderr, chunk, MAX_VALIDATOR_OUTPUT_BYTES);
      stderr = next.next;
      truncated ||= next.truncated;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        command,
        ok: !timedOut && code === 0,
        exitCode: code,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        truncated,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        truncated,
      });
    });
  });
}

async function runValidatorSequence(commands: string[]): Promise<{
  passed: boolean;
  failedCommand: string | null;
  results: ValidatorResult[];
}> {
  const results: ValidatorResult[] = [];
  for (const command of commands) {
    const result = await runValidatorCommand(command);
    results.push(result);
    if (!result.ok) {
      return {
        passed: false,
        failedCommand: command,
        results,
      };
    }
  }
  return {
    passed: true,
    failedCommand: null,
    results,
  };
}

function writeOfflineRepairArtifact(relativeDir: string, batchId: string, artifact: OfflineRepairArtifact): string {
  const dir = resolveWorkspacePath(relativeDir, DEFAULT_OFFLINE_REPAIR_ARTIFACTS_DIR);
  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${batchId}.json`;
  const absolutePath = join(dir, fileName);
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return absolutePath;
}

function isLocalEngineUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1" || parsed.hostname.startsWith("100.");
  } catch {
    return false;
  }
}

export function mountOpsControlRoutes(app: express.Application, deps: OpsControlMountDeps): void {
  const {
    requireRole,
    requireClearance,
    withAsyncMiddleware,
    opsCommandRuntime,
    ingestionRuntime,
    opsPersistenceEnabled,
    enqueueOpsCommandWithPersistence,
    hydratePersistedSourceHealthState,
    buildThreatSummaryPayload,
    loadDtnIslStatus,
    getLastTriadReport,
  } = deps;

  const plannerCircuit: PlannerCircuitState = {
    consecutiveFailures: 0,
    openUntilMs: 0,
  };
  const safeCommandApprovalVault = new SafeCommandApprovalVault({
    ttlMs: safeCommandApprovalTtlMs(),
    maxEntries: Math.max(64, Math.min(parseEnvInt("ORCHESTRATOR_SAFE_COMMAND_MAX_PENDING_APPROVALS", 512), 2_000)),
  });
  const workerMesh = createWorkerMeshBroker({
    ingestionRuntime,
    offlineRepairCapsulePath: deps.offlineRepairCapsulePath,
    offlineRepairArtifactsDir: deps.offlineRepairArtifactsDir,
    enqueueOpsCommandWithPersistence,
  });

  function actorForRequest(req: AuthenticatedRequest) {
    return {
      userId: req.auth?.userId ?? null,
      role: req.auth?.role ?? null,
    };
  }

  async function runRuntimeWorkerTick(req: AuthenticatedRequest): Promise<void> {
    const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
      route: "/api/ops/command/latest",
    });
    await workerMesh.dispatch(
      createWorkerTaskEnvelope({
        lane: "runtime",
        kind: "telemetry-refresh",
        priority: "low",
        source: "runtime",
        actor: actorForRequest(req),
        memory: {
          level: memory.level,
        },
        payload: {
          mode: ingestionRuntime.getStatus().mode,
        },
      }),
      { followHandoffs: true },
    );
  }

  function plannerCircuitOpen(): boolean {
    return plannerCircuit.openUntilMs > Date.now();
  }

  function resetPlannerCircuit(): void {
    plannerCircuit.consecutiveFailures = 0;
    plannerCircuit.openUntilMs = 0;
  }

  function registerPlannerFailure(): void {
    const threshold = Math.max(
      1,
      Math.round(parseRequestNumber(process.env.ORCHESTRATOR_PLANNER_CIRCUIT_FAILURE_THRESHOLD, 3, 1, 20)),
    );
    const cooldownMs = Math.max(
      1_000,
      Math.round(parseRequestNumber(process.env.ORCHESTRATOR_PLANNER_CIRCUIT_COOLDOWN_MS, 30_000, 1_000, 600_000)),
    );
    plannerCircuit.consecutiveFailures += 1;
    if (plannerCircuit.consecutiveFailures >= threshold) {
      plannerCircuit.openUntilMs = Date.now() + cooldownMs;
      opsCommandRuntime.notePlanner({ circuitOpen: true });
    }
  }

  app.get(
    "/api/ops/command/latest",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      await runRuntimeWorkerTick(req);

      const lookbackMs = parseLookback(req.query.lookback, 30 * 60 * 1000);
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 96), 240));
      const horizonMinutes = Math.max(5, Math.min(Number(req.query.horizonMinutes ?? 30), 240));
      const latest = getLatestCanonical();
      const sequence = filterByLookback(getCanonicalFeed(), lookbackMs, limit);
      const canonicalLatest = latest ?? sequence[sequence.length - 1] ?? null;

      if (!canonicalLatest) {
        res.status(404).json({ error: "No canonical feed data yet" });
        return;
      }

      const sourceStatus =
        getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState();
      const threatSummary = buildThreatSummaryPayload(
        sequence.length > 0 ? sequence : [canonicalLatest],
        lookbackMs,
        "memory",
        horizonMinutes,
      );
      const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/status",
      });
      const queue = workerMesh.getQueue();
      const workers = workerMesh.listWorkers(memory);

      res.json({
        updatedAt: new Date().toISOString(),
        session: {
          authRequired: true,
          authenticated: Boolean(req.auth?.userId ?? req.auth?.email ?? req.auth?.role),
          role: req.auth?.role ?? null,
          clearance: req.auth?.clearance ?? null,
          userId: req.auth?.userId ?? null,
          email: req.auth?.email ?? null,
          emailVerified: true,
          features: featuresForRole(req.auth?.role),
        },
        sourceStatus,
        canonicalLatest,
        mmsLatest: getLatestMms() ?? null,
        auroraLatest: getAuroraMap() ?? null,
        threatSummary,
        dtnIslStatus: await loadDtnIslStatus(),
        cybertigerStatus: null,
        statusChips: [
          {
            id: "memory",
            label: "memory",
            tone: memory.level === "critical" ? "critical" : memory.level === "constrained" ? "warn" : "ok",
            value: `${memory.freeMb} MB`,
          },
          {
            id: "workers",
            label: "workers",
            tone: workers.some((worker) => worker.state === "degraded") ? "warn" : "ok",
            value: `${workers.filter((worker) => worker.enabled).length} active`,
          },
          {
            id: "approvals",
            label: "approvals",
            tone: queue.queuedApprovals.length > 0 ? "warn" : "info",
            value: String(queue.queuedApprovals.length),
          },
        ],
        workers,
        queuedApprovals: queue.queuedApprovals,
        brokerPolicy: workerMesh.getPolicy(memory),
      });
    }),
  );

  app.post(
    "/api/ops/command",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as {
        command_type?: string;
        payload?: unknown;
        execute?: unknown;
        simulate?: unknown;
        idempotency_key?: unknown;
        context?: unknown;
      };
      const commandTypeRaw = typeof body?.command_type === "string" ? body.command_type.trim().toLowerCase() : "";
      if (!commandTypeRaw) {
        res.status(400).json({ error: "command_type is required" });
        return;
      }
      if (!isOpsCommandType(commandTypeRaw)) {
        res.status(400).json({ error: `command_type must be one of: ${ALLOWED_OPS_COMMAND_TYPES.join(", ")}` });
        return;
      }
      const execute = parseRequestBool(body.execute, false);
      const simulate = parseRequestBool(body.simulate, false);
      const payload = asRecord(body.payload);
      const context = asRecord(body.context);
      const idempotencyKey = parseIdempotencyKey(body.idempotency_key);
      const powerState = resolvePlannerPowerState(context);
      const profile = resolvePlannerModelProfile(
        process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model",
        powerState,
      );
      if (powerState.constrained && isHeavyCommand(commandTypeRaw)) {
        opsCommandRuntime.notePlanner({ batteryThrottle: true });
        recordOperationalLimitContext({
          kind: "battery",
          source: "ops-command",
          detail: {
            route: "/api/ops/command",
            commandType: commandTypeRaw,
            batteryPercent: powerState.batteryPercent,
            charging: powerState.charging,
            powerSource: powerState.powerSource,
            thermalConstrained: powerState.thermalConstrained,
            reason: powerState.reason,
          },
        });
      }

      if (execute && commandNeedsMissionClearance(commandTypeRaw) && !hasMissionClearance(req.auth?.clearance)) {
        res.status(403).json({ error: "Executing this command requires mission clearance" });
        return;
      }

      const row = await insertCommandLog({
        command_type: commandTypeRaw,
        payload: {
          ...payload,
          execute,
          simulate,
          idempotency_key: idempotencyKey,
          policy_reason: buildPolicyReason({
            commandType: commandTypeRaw,
            execute,
            simulate,
            powerProfile: profile.profile,
            constrained: powerState.constrained,
          }),
        },
        role: req.auth?.role ?? null,
        user_id: req.auth?.userId ?? null,
      });
      if (!row) {
        res.status(503).json({ error: "Command log unavailable (PostgreSQL not configured or error)" });
        return;
      }

      if (!execute && !simulate) {
        res.status(201).json(row);
        return;
      }

      const { job, deduped } = await enqueueOpsCommandWithPersistence({
        commandType: commandTypeRaw,
        payload,
        source: "manual",
        simulate,
        idempotencyKey,
        requestedBy: req.auth?.userId ?? null,
        heavyCommand: isHeavyCommand(commandTypeRaw),
        powerConstrained: powerState.constrained,
      });
      res.status(deduped ? 200 : 202).json({
        log: row,
        job,
        deduped,
        planner: {
          power: powerState,
          profile,
        },
      });
    }),
  );

  app.post(
    "/api/ops/command/model",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as {
        prompt?: unknown;
        context?: unknown;
        execute?: unknown;
        simulate?: unknown;
        model?: unknown;
        idempotency_key?: unknown;
      };

      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const memoryGovernor = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/plan",
      });
      if (memoryGovernor.level === "critical") {
        res.status(503).json({
          error: "Model planner is disabled while RAM is critical",
        });
        return;
      }

      const chatUrl = resolveLocalEngineChatUrl();
      if (!chatUrl) {
        res.status(503).json({
          error: "Local chat engine is not configured (set ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL)",
        });
        return;
      }

      const execute = parseRequestBool(body.execute, true);
      const simulate = parseRequestBool(body.simulate, false);
      const requestedModel =
        (typeof body.model === "string" && body.model.trim().length > 0
          ? body.model.trim()
          : process.env.ORCHESTRATOR_CHAT_MODEL?.trim()) || "local-model";
      const context = asRecord(body.context);
      const idempotencyKeyFromRequest = parseIdempotencyKey(body.idempotency_key);
      const powerState = resolvePlannerPowerState(context);
      const profile = resolvePlannerModelProfile(requestedModel, powerState);
      if (powerState.constrained) {
        opsCommandRuntime.notePlanner({ batteryThrottle: true });
        recordOperationalLimitContext({
          kind: "battery",
          source: "ops-command-model",
          detail: {
            route: "/api/ops/command/model",
            batteryPercent: powerState.batteryPercent,
            charging: powerState.charging,
            powerSource: powerState.powerSource,
            thermalConstrained: powerState.thermalConstrained,
            reason: powerState.reason,
          },
        });
      }
      if (plannerCircuitOpen()) {
        opsCommandRuntime.notePlanner({ failure: true });
        res.status(503).json({
          error: "Planner circuit is open due to repeated local engine failures",
          retry_after: new Date(plannerCircuit.openUntilMs).toISOString(),
        });
        return;
      }
      opsCommandRuntime.notePlanner({ request: true });

      const latest = getLatestCanonical();
      const plannerLookbackMs = 60 * 60 * 1000;
      const plannerSequence = filterByLookback(getCanonicalFeed(), plannerLookbackMs, 24);
      const plannerSourceStatus =
        getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState();
      const degradedSources = plannerSourceStatus
        .filter((source) => !source.healthy)
        .map((source) => source.source);
      const plannerThreatSummary =
        plannerSequence.length > 0
          ? buildThreatSummaryPayload(plannerSequence, plannerLookbackMs, "memory", 60)
          : null;
      const plannerTrendSummary = buildPlannerTrendSummary({
        sequence: plannerSequence.length > 0 && latest ? plannerSequence : latest ? [latest] : [],
        sourceStatus: plannerSourceStatus,
        threatContext: plannerThreatSummary
          ? {
            gateAction: plannerThreatSummary.gate.action as "TRIGGER_LLM" | "LOG_AND_SLEEP",
            topThreatType: plannerThreatSummary.summary.top_threat_type,
            topThreatScore: plannerThreatSummary.summary.top_threat_score,
            topRecommendedAction: plannerThreatSummary.summary.top_recommended_action,
            actionableThreatCount: plannerThreatSummary.summary.actionable_threat_count,
          }
          : undefined,
      });

      const planningSystemPrompt = buildGovernedModelSystemPrompt({
        role: "You are Model command planner for Gauss mission operations.",
        directives: [
          `Choose exactly one command from: ${ALLOWED_OPS_COMMAND_TYPES.join(", ")}.`,
          "Return ONLY valid JSON object with keys: command_type, payload, reason, confidence.",
          "Do not return markdown, explanation, or extra fields.",
          "If uncertain, choose log-health-check.",
        ],
      });

      const planningUserPrompt = [
        `Operator request: ${prompt}`,
        `Live snapshot: storm_tier=${latest?.alerts.stormTier ?? "unknown"}, kp=${latest?.indices.kp ?? "n/a"}, bz=${latest?.magneticField.z ?? "n/a"}`,
        `Trend summary: ${JSON.stringify(plannerTrendSummary)}`,
        `Degraded sources: ${degradedSources.length > 0 ? degradedSources.join(", ") : "none"}`,
        `Additional context: ${JSON.stringify(context).slice(0, 1200)}`,
      ].join("\n");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const apiKey = resolveLocalEngineApiKey();
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const plannerPayload = {
        model: profile.model,
        temperature: profile.temperature,
        max_tokens: profile.maxTokens,
        messages: [
          { role: "system", content: planningSystemPrompt },
          { role: "user", content: planningUserPrompt },
        ],
      };

      let plannerResult: { status: number; rawText: string; latencyMs: number };
      try {
        plannerResult = await requestPlannerWithRetry(chatUrl, headers, plannerPayload);
      } catch (error) {
        registerPlannerFailure();
        opsCommandRuntime.notePlanner({ failure: true });
        res.status(502).json({
          error: "Model command planning request failed",
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      opsCommandRuntime.notePlanner({ latencyMs: plannerResult.latencyMs });

      if (plannerResult.status < 200 || plannerResult.status >= 300) {
        registerPlannerFailure();
        opsCommandRuntime.notePlanner({ failure: true });
        res.status(502).json({
          error: "Model command planning failed",
          detail: `HTTP ${plannerResult.status}: ${plannerResult.rawText.slice(0, 240)}`,
        });
        return;
      }

      let parsedResponse: Record<string, unknown>;
      try {
        parsedResponse = JSON.parse(plannerResult.rawText) as Record<string, unknown>;
      } catch {
        registerPlannerFailure();
        opsCommandRuntime.notePlanner({ failure: true });
        res.status(502).json({
          error: "Model command planning returned invalid JSON envelope",
        });
        return;
      }

      const content = extractChatContent(parsedResponse);
      if (!content) {
        res.status(502).json({
          error: "Model command planning response had no parseable message content",
        });
        return;
      }

      const plan = parseModelCommandPlan(content);
      if (!plan) {
        registerPlannerFailure();
        opsCommandRuntime.notePlanner({ parseFailure: true, failure: true });
        res.status(422).json({
          error: "Could not parse a valid allowlisted command from model output",
          model_output_preview: content.slice(0, 240),
        });
        return;
      }
      resetPlannerCircuit();

      if (execute && commandNeedsMissionClearance(plan.command_type) && !hasMissionClearance(req.auth?.clearance)) {
        res.status(403).json({ error: "Executing this command requires mission clearance" });
        return;
      }

      const modelOutputSha256 = createHash("sha256").update(content).digest("hex");
      const idempotencyKey = idempotencyKeyFromRequest ?? modelOutputSha256;
      const policyReason = buildPolicyReason({
        commandType: plan.command_type,
        execute,
        simulate,
        powerProfile: profile.profile,
        constrained: powerState.constrained,
      });

      const row = await insertCommandLog({
        command_type: plan.command_type,
        payload: {
          ...plan.payload,
          execute,
          simulate,
          model: profile.model,
          planner_profile: profile.profile,
          planner: "deepseek",
          reason: plan.reason,
          confidence: plan.confidence,
          model_output_sha256: modelOutputSha256,
          policy_reason: policyReason,
          idempotency_key: idempotencyKey,
          request_prompt: prompt.slice(0, 800),
        },
        role: req.auth?.role ?? null,
        user_id: req.auth?.userId ?? null,
      });
      if (!row) {
        res.status(503).json({ error: "Command log unavailable (PostgreSQL not configured or error)" });
        return;
      }

      if (!execute && !simulate) {
        res.status(201).json({
          command: plan,
          log: row,
          planner: {
            power: powerState,
            profile,
          },
        });
        return;
      }

      const { job, deduped } = await enqueueOpsCommandWithPersistence({
        commandType: plan.command_type,
        payload: plan.payload,
        source: "external-model",
        simulate,
        idempotencyKey,
        requestedBy: req.auth?.userId ?? null,
        heavyCommand: isHeavyCommand(plan.command_type),
        powerConstrained: powerState.constrained,
      });
      res.status(deduped ? 200 : 202).json({
        command: plan,
        log: row,
        job,
        deduped,
        planner: {
          power: powerState,
          profile,
        },
      });
    }),
  );

  app.post(
    "/api/ops/command/model/run/plan",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      if (!isSafeCommandRunnerEnabled()) {
        res.status(503).json({ error: "Safe command runner is disabled" });
        return;
      }

      const body = req.body as {
        prompt?: unknown;
        context?: unknown;
        model?: unknown;
      };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }
      const memoryGovernor = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/safe-plan",
      });
      if (memoryGovernor.level === "critical") {
        res.status(503).json({
          error: "Model safe planner is disabled while RAM is critical",
        });
        return;
      }
      const chatUrl = resolveLocalEngineChatUrl();
      if (!chatUrl) {
        res.status(503).json({
          error: "Local chat engine is not configured (set ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL)",
        });
        return;
      }

      const context = asRecord(body.context);
      const requestedModel =
        (typeof body.model === "string" && body.model.trim().length > 0
          ? body.model.trim()
          : process.env.ORCHESTRATOR_CHAT_MODEL?.trim()) || "local-model";
      const powerState = resolvePlannerPowerState(context);
      const profile = resolvePlannerModelProfile(requestedModel, powerState);
      const allowlist = resolveSafeCommandAllowlist(process.env);
      const allowlistHint = Array.from(allowlist).sort().join(", ");
      opsCommandRuntime.notePlanner({ request: true });
      const latestSafePlanner = getLatestCanonical();
      const safePlannerLookbackMs = 60 * 60 * 1000;
      const safePlannerSequence = filterByLookback(getCanonicalFeed(), safePlannerLookbackMs, 24);
      const safePlannerThreatSummary =
        safePlannerSequence.length > 0
          ? buildThreatSummaryPayload(safePlannerSequence, safePlannerLookbackMs, "memory", 60)
          : null;
      const safePlannerTrendSummary = buildPlannerTrendSummary({
        sequence:
          safePlannerSequence.length > 0
            ? safePlannerSequence
            : latestSafePlanner
              ? [latestSafePlanner]
              : [],
        sourceStatus:
          getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState(),
        threatContext: safePlannerThreatSummary
          ? {
            gateAction: safePlannerThreatSummary.gate.action as "TRIGGER_LLM" | "LOG_AND_SLEEP",
            topThreatType: safePlannerThreatSummary.summary.top_threat_type,
            topThreatScore: safePlannerThreatSummary.summary.top_threat_score,
            topRecommendedAction: safePlannerThreatSummary.summary.top_recommended_action,
            actionableThreatCount: safePlannerThreatSummary.summary.actionable_threat_count,
          }
          : undefined,
      });

      const planningSystemPrompt = buildGovernedModelSystemPrompt({
        role: "You are a safe command planner for Gauss mission operations.",
        directives: [
          "Return ONLY valid JSON object with keys: executable, args, reason, confidence, risk.",
          "Never return markdown, prose, or code fences.",
          `Executable MUST be one of: ${allowlistHint}.`,
          "Args must be minimal, diagnostics-only, and never destructive.",
          "If uncertain, choose executable=pmset args=['-g','batt'] risk='low'.",
        ],
      });
      const planningUserPrompt = [
        `Operator request: ${prompt}`,
        `Trend summary: ${JSON.stringify(safePlannerTrendSummary)}`,
        `Context: ${JSON.stringify(context).slice(0, 1200)}`,
      ].join("\n");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const apiKey = resolveLocalEngineApiKey();
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const plannerPayload = {
        model: profile.model,
        temperature: Math.min(profile.temperature, 0.1),
        max_tokens: Math.min(profile.maxTokens, 260),
        messages: [
          { role: "system", content: planningSystemPrompt },
          { role: "user", content: planningUserPrompt },
        ],
      };

      let plannerResult: { status: number; rawText: string; latencyMs: number };
      try {
        plannerResult = await requestPlannerWithRetry(chatUrl, headers, plannerPayload);
      } catch (error) {
        opsCommandRuntime.notePlanner({ failure: true });
        registerPlannerFailure();
        res.status(502).json({
          error: "Model safe command planning request failed",
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      opsCommandRuntime.notePlanner({ latencyMs: plannerResult.latencyMs });
      if (plannerResult.status < 200 || plannerResult.status >= 300) {
        opsCommandRuntime.notePlanner({ failure: true });
        registerPlannerFailure();
        res.status(502).json({
          error: "Model safe command planning failed",
          detail: `HTTP ${plannerResult.status}: ${plannerResult.rawText.slice(0, 240)}`,
        });
        return;
      }

      let parsedResponse: Record<string, unknown>;
      try {
        parsedResponse = JSON.parse(plannerResult.rawText) as Record<string, unknown>;
      } catch {
        opsCommandRuntime.notePlanner({ failure: true, parseFailure: true });
        registerPlannerFailure();
        res.status(502).json({ error: "Planner returned invalid JSON envelope" });
        return;
      }
      const content = extractChatContent(parsedResponse);
      let plan: SafeCommandPlan | null = null;
      let fallbackUsed = false;
      if (content) {
        plan = parseSafeCommandPlan(content);
      }
      if (!plan) {
        opsCommandRuntime.notePlanner({ failure: true, parseFailure: true });
        if (!safeCommandPlannerFallbackEnabled()) {
          res.status(422).json({
            error: content
              ? "Could not parse safe command from model output"
              : "Planner response had no parseable content",
            model_output_preview: content ? content.slice(0, 260) : null,
          });
          return;
        }
        plan = buildFallbackSafeCommandPlan(prompt, allowlist);
        fallbackUsed = true;
      }
      const validation = validateSafeCommandPlan(plan, allowlist);
      if (!validation.ok) {
        res.status(422).json({ error: validation.reason ?? "Plan failed safety validation" });
        return;
      }
      resetPlannerCircuit();

      const proposal = buildSafeCommandProposal({
        plan,
        prompt,
        requestedBy: req.auth?.userId ?? null,
        approvalTtlMs: safeCommandApprovalTtlMs(),
      });
      const approval = safeCommandApprovalVault.issue(proposal);

      const audit = await insertSafeCommandAuditLog({
        command_type: "safe-command-plan",
        payload: {
          planner: "deepseek",
          model: profile.model,
          planner_profile: profile.profile,
          power_reason: powerState.reason,
          proposal_id: proposal.proposalId,
          prompt_digest: proposal.promptDigest,
          command_preview: proposal.commandPreview,
          executable: proposal.plan.executable,
          args: proposal.plan.args,
          reason: proposal.plan.reason,
          confidence: proposal.plan.confidence,
          risk: proposal.plan.risk,
          planner_fallback_used: fallbackUsed,
          require_approval: safeCommandRequireApproval(),
          approval_token_sha256: approval.approvalTokenHash,
          approval_expires_at: approval.expiresAt,
          allowlist: safeCommandAllowlistPreview(),
        },
        role: req.auth?.role ?? null,
        user_id: req.auth?.userId ?? null,
      });
      if (!audit) {
        res.status(503).json({ error: "Audit log unavailable for safe command planner" });
        return;
      }

      res.status(201).json({
        proposal,
        approval: safeCommandRequireApproval()
          ? {
            token: approval.approvalToken,
            expires_at: approval.expiresAt,
          }
          : null,
        allowlist: safeCommandAllowlistPreview(),
        log: audit.log,
        audit: {
          persisted: audit.persisted,
        },
      });
    }),
  );

  app.post(
    "/api/ops/command/model/run/execute",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      if (!isSafeCommandRunnerEnabled()) {
        res.status(503).json({ error: "Safe command runner is disabled" });
        return;
      }

      const body = req.body as {
        approval_token?: unknown;
        simulate?: unknown;
        plan?: unknown;
      };
      const approvalToken = typeof body.approval_token === "string" ? body.approval_token.trim() : "";
      const simulate = parseRequestBool(body.simulate, false);
      const allowlist = resolveSafeCommandAllowlist(process.env);
      const requireApproval = safeCommandRequireApproval();
      const requestedBy = req.auth?.userId ?? null;

      let proposal: SafeCommandProposal | null = null;
      if (requireApproval) {
        if (!approvalToken) {
          res.status(400).json({ error: "approval_token is required" });
          return;
        }
        const peeked = safeCommandApprovalVault.peek(approvalToken, requestedBy);
        if (!peeked) {
          res.status(403).json({ error: "Approval token is invalid, expired, or belongs to another operator" });
          return;
        }
        proposal = peeked.proposal;
      } else {
        const parsedPlan = parseSafeCommandPlan(asRecord(body.plan));
        if (!parsedPlan) {
          res.status(400).json({ error: "plan is required when approval flow is disabled" });
          return;
        }
        proposal = buildSafeCommandProposal({
          plan: parsedPlan,
          prompt: "direct-plan",
          requestedBy,
        });
      }

      const resolvedProposal = proposal;
      if (!resolvedProposal) {
        res.status(500).json({ error: "Safe command proposal resolution failed" });
        return;
      }

      const validation = validateSafeCommandPlan(resolvedProposal.plan, allowlist);
      if (!validation.ok) {
        const audit = await insertSafeCommandAuditLog({
          command_type: "safe-command-execute",
          payload: {
            stage: "blocked",
            reason: validation.reason,
            proposal_id: resolvedProposal.proposalId,
            executable: resolvedProposal.plan.executable,
            args: resolvedProposal.plan.args,
            command_preview: resolvedProposal.commandPreview,
            approval_token_sha256: approvalToken ? createHash("sha256").update(approvalToken).digest("hex") : null,
          },
          role: req.auth?.role ?? null,
          user_id: requestedBy,
        });
        if (!audit) {
          res.status(503).json({ error: "Audit log unavailable for blocked safe command execution" });
          return;
        }
        res.status(422).json({
          error: validation.reason ?? "Command failed safe allowlist policy",
          log: audit.log,
          audit: {
            persisted: audit.persisted,
          },
        });
        return;
      }

      const preAudit = await insertSafeCommandAuditLog({
        command_type: "model-safe-command-execute",
        payload: {
          stage: "preflight",
          simulate,
          proposal_id: resolvedProposal.proposalId,
          command_preview: resolvedProposal.commandPreview,
          executable: resolvedProposal.plan.executable,
          args: resolvedProposal.plan.args,
          reason: resolvedProposal.plan.reason,
          confidence: resolvedProposal.plan.confidence,
          risk: resolvedProposal.plan.risk,
          approval_required: requireApproval,
          approval_token_sha256: approvalToken ? createHash("sha256").update(approvalToken).digest("hex") : null,
          timeout_ms: safeCommandTimeoutMs(),
          max_output_bytes: safeCommandMaxOutputBytes(),
        },
        role: req.auth?.role ?? null,
        user_id: requestedBy,
      });
      if (!preAudit) {
        res.status(503).json({ error: "Audit log unavailable before command execution" });
        return;
      }

      if (requireApproval) {
        const consumed = safeCommandApprovalVault.consume(approvalToken, requestedBy);
        if (!consumed) {
          res.status(409).json({ error: "Approval token is no longer valid" });
          return;
        }
        proposal = consumed.proposal;
      }

      const executableProposal = proposal ?? resolvedProposal;

      const execution = simulate
        ? {
          ok: true,
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 0,
          stdout: "",
          stderr: "",
          truncated: false,
          commandPreview: executableProposal.commandPreview,
        }
        : await runSafeCommand(executableProposal.plan, {
          timeoutMs: safeCommandTimeoutMs(),
          maxOutputBytes: safeCommandMaxOutputBytes(),
          cwd: (process.env.ORCHESTRATOR_SAFE_COMMAND_CWD ?? process.cwd()).trim() || process.cwd(),
        });

      const resultAudit = await insertSafeCommandAuditLog({
        command_type: "model-safe-command-execute",
        payload: {
          stage: "result",
          simulate,
          proposal_id: executableProposal.proposalId,
          command_preview: executableProposal.commandPreview,
          executable: executableProposal.plan.executable,
          args: executableProposal.plan.args,
          reason: executableProposal.plan.reason,
          confidence: executableProposal.plan.confidence,
          risk: executableProposal.plan.risk,
          execution,
        },
        role: req.auth?.role ?? null,
        user_id: requestedBy,
      });
      if (!resultAudit) {
        res.status(503).json({ error: "Audit log unavailable after command execution" });
        return;
      }

      res.status(execution.ok || simulate ? 200 : 202).json({
        proposal: executableProposal,
        execution,
        log: resultAudit.log,
        audit: {
          persisted: resultAudit.persisted,
          preflight_persisted: preAudit.persisted,
        },
      });
    }),
  );

  app.get("/api/ops/command/job/:jobId", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
    const jobId = typeof req.params.jobId === "string" ? req.params.jobId.trim() : "";
    const persisted = jobId && opsPersistenceEnabled && getCommandLogPool() ? await getOpsCommandJob(jobId) : null;
    if (persisted) {
      opsCommandRuntime.adoptPersistedJob(persisted);
    }
    const job = persisted ?? (jobId ? opsCommandRuntime.getJob(jobId) : null);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json({ job });
  }));

  app.get("/api/ops/command/jobs", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 25), 250));
    if (opsPersistenceEnabled && getCommandLogPool()) {
      const jobs = await listOpsCommandJobs(limit);
      for (const job of jobs) {
        opsCommandRuntime.adoptPersistedJob(job);
      }
      res.json({ jobs });
      return;
    }
    res.json({ jobs: opsCommandRuntime.listJobs(limit) });
  }));

  app.get("/api/ops/command/metrics", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    res.json({
      metrics: opsCommandRuntime.snapshotMetrics(),
      planner_circuit: {
        open: plannerCircuitOpen(),
        open_until: plannerCircuit.openUntilMs > 0 ? new Date(plannerCircuit.openUntilMs).toISOString() : null,
        consecutive_failures: plannerCircuit.consecutiveFailures,
      },
    });
  });

  app.get("/api/ops/control/workers", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
      route: "/api/ops/control/workers",
    });
    res.json({
      workers: workerMesh.listWorkers(memory),
      brokerPolicy: workerMesh.getPolicy(memory),
    });
  });

  app.get(
    "/api/ops/control/delegation/queue",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res) => {
      const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/delegation/queue",
      });
      res.json({
        ...workerMesh.getQueue(),
        brokerPolicy: workerMesh.getPolicy(memory),
      });
    },
  );

  app.post(
    "/api/ops/control/delegation/dispatch",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as {
        workerId?: unknown;
        lane?: unknown;
        kind?: unknown;
        priority?: unknown;
        source?: unknown;
        payload?: unknown;
        relatedArtifacts?: unknown;
      };

      const lane = parseWorkerLane(body.lane) ?? "runtime";
      const kind = parseWorkerTaskKind(body.kind);
      if (!kind) {
        res.status(400).json({ error: "kind must be a supported worker task kind" });
        return;
      }

      const task = createWorkerTaskEnvelope({
        lane,
        kind,
        priority: parseWorkerTaskPriority(body.priority) ?? "medium",
        source: parseWorkerTaskSource(body.source) ?? "command-ui",
        actor: actorForRequest(req),
        payload: asRecord(body.payload),
        relatedArtifacts: Array.isArray(body.relatedArtifacts)
          ? body.relatedArtifacts.filter((item): item is string => typeof item === "string")
          : [],
        requestedWorkerId: parseWorkerId(body.workerId),
      });

      const execution = await workerMesh.dispatch(task, { followHandoffs: true });
      const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/delegation/dispatch",
      });
      res.status(202).json({
        task,
        result: execution.result,
        workers: workerMesh.listWorkers(memory),
        queuedApprovals: workerMesh.getQueue().queuedApprovals,
        brokerPolicy: workerMesh.getPolicy(memory),
      });
    }),
  );

  app.post(
    "/api/ops/control/delegation/approve",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as { taskId?: unknown };
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      const execution = await workerMesh.approve({ taskId });
      const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/delegation/approve",
      });
      res.json({
        result: execution.result,
        workers: workerMesh.listWorkers(memory),
        queuedApprovals: workerMesh.getQueue().queuedApprovals,
        brokerPolicy: workerMesh.getPolicy(memory),
      });
    }),
  );

  app.post(
    "/api/ops/control/delegation/reject",
    requireRole("operator"),
    requireClearance("mission"),
    (req: AuthenticatedRequest, res) => {
      const body = req.body as { taskId?: unknown };
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      const execution = workerMesh.reject({ taskId });
      const memory = getTrackedRuntimeMemoryPressureSnapshot("ops-control", {
        route: "/api/ops/control/delegation/reject",
      });
      res.json({
        result: execution.result,
        workers: workerMesh.listWorkers(memory),
        queuedApprovals: workerMesh.getQueue().queuedApprovals,
        brokerPolicy: workerMesh.getPolicy(memory),
      });
    },
  );

  app.get("/api/ops/command/log", withAsyncMiddleware(async (_req: AuthenticatedRequest, res) => {
    const limit = Math.max(1, Math.min(Number(_req.query.limit ?? 50), 500));
    const rows = await getCommandLogLatest(limit);
    res.json({ commands: rows });
  }));

  app.get("/api/ops/pipeline/triad/latest", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    const lastTriadReport = getLastTriadReport();
    if (lastTriadReport === null) {
      res.status(404).json({ error: "No Triad report yet. Run POST /api/ops/pipeline/triad first." });
      return;
    }
    res.json(lastTriadReport);
  });

  app.post("/api/ops/exogenous", requireRole("operator"), (req: AuthenticatedRequest, res) => {
    const context = req.body;
    if (!context || typeof context !== "object") {
      return res.status(400).json({ error: "Missing exogenous context payload" });
    }
    setExogenousContext(context);
    res.json({ ok: true });
  });

  app.get("/api/ops/exogenous", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    res.json(getExogenousContext() || {});
  });

  app.get("/api/ops/threat-summary", requireRole("operator"), async (_req: AuthenticatedRequest, res) => {
    res.json(await loadDtnIslStatus());
  });

  app.get("/api/ops/network/audit", requireRole("operator"), async (_req: AuthenticatedRequest, res) => {
    res.json(await loadDtnIslStatus());
  });

  app.get("/api/ops/runtime/status", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    res.json(ingestionRuntime.getStatus());
  });

  app.get("/api/ops/runtime/kali-supervisor", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    const report = readKaliSupervisorReport();
    if (!report) {
      res.status(404).json({
        error: "Kali supervisor report is unavailable or invalid",
        report_path: kaliSupervisorReportPath(),
      });
      return;
    }
    res.json(report);
  });

  app.post("/api/ops/runtime/mode", requireRole("operator"), (req: AuthenticatedRequest, res) => {
    const body = req.body as {
      mode?: unknown;
      source?: unknown;
    };
    const mode = parseIngestionRuntimeMode(body.mode);
    if (!mode) {
      res.status(400).json({
        error: "Invalid runtime mode. Use one of: active, suspended, offloaded.",
      });
      return;
    }

    const source =
      typeof body.source === "string" && body.source.trim().length > 0
        ? body.source.trim().slice(0, 64)
        : "api";
    res.json(ingestionRuntime.setMode(mode, source));
  });

  app.get("/api/ops/audit/summary", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
    const summary = readRequirementsAuditSummary();
    if (summary.error) {
      res.status(500).json(summary);
      return;
    }
    res.json(summary);
  });

  app.post(
    "/api/ops/repair/offline/pairing",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const requestedBatchId =
        typeof req.body?.batch_id === "string" && req.body.batch_id.trim().length > 0
          ? req.body.batch_id.trim()
          : typeof req.query.batch_id === "string" && req.query.batch_id.trim().length > 0
            ? req.query.batch_id.trim()
            : null;
      const capsulePath = resolveWorkspacePath(
        deps.offlineRepairCapsulePath,
        DEFAULT_OFFLINE_REPAIR_CAPSULE_PATH,
      );
      const capsule = readOfflineRepairCapsule(capsulePath);
      if (!capsule) {
        res.status(404).json({
          error: "Offline repair capsule not found or unreadable. Run npm run repair:offline:capsule first.",
          capsule_path: capsulePath,
        });
        return;
      }

      const batch = selectOfflineRepairBatch(capsule, requestedBatchId);
      const pairingSummary = resolvePairingSummary(capsule);

      res.status(200).json({
        capsule_generated_at: capsule.generated_at,
        pairing_summary: pairingSummary,
        active_batch:
          batch == null
            ? null
            : {
              batch,
              pairing: resolveBatchPairing(batch),
              targets: uniqueTargetsFromBatch(batch),
            },
      });
    }),
  );

  app.post(
    "/api/ops/repair/offline/plan",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as {
        batch_id?: unknown;
        model?: unknown;
        context?: unknown;
        run_validators?: unknown;
      };
      const requestedBatchId = typeof body.batch_id === "string" ? body.batch_id.trim() || null : null;
      const requestedModel =
        typeof body.model === "string" && body.model.trim().length > 0
          ? body.model.trim()
          : process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model";
      const runValidators = parseRequestBool(body.run_validators, true);
      const context = asRecord(body.context);
      const capsulePath = resolveWorkspacePath(
        deps.offlineRepairCapsulePath,
        DEFAULT_OFFLINE_REPAIR_CAPSULE_PATH,
      );
      const capsule = readOfflineRepairCapsule(capsulePath);
      if (!capsule) {
        res.status(404).json({
          error: "Offline repair capsule not found or unreadable. Run npm run repair:offline:capsule first.",
          capsule_path: capsulePath,
        });
        return;
      }

      const batch = selectOfflineRepairBatch(capsule, requestedBatchId);
      if (!batch) {
        res.status(404).json({
          error: requestedBatchId
            ? `Offline repair batch '${requestedBatchId}' was not found.`
            : "Offline repair capsule has no repair batches.",
        });
        return;
      }

      const powerState = resolvePlannerPowerState(context);
      const profile = resolvePlannerModelProfile(requestedModel, powerState);
      const chatUrl = resolveLocalEngineChatUrl() ?? (typeof capsule.profile.local_engine_url === "string" ? capsule.profile.local_engine_url : null);
      const strictLocalInference = capsule.profile.strict_local_inference !== false;
      const allowedTargets = uniqueTargetsFromBatch(batch);
      const pairing = resolveBatchPairing(batch);
      const fileContexts = allowedTargets
        .map((target) => readTargetPreview(capsule.root || process.cwd(), target))
        .filter((entry): entry is { file: string; preview: string } => Boolean(entry));

      let plannerMode: OfflineRepairArtifact["planner"]["mode"] = "deterministic-fallback";
      let plannerLatencyMs: number | null = null;
      let fallbackReason: string | null = null;
      let proposal = buildFallbackOfflineRepairProposal(batch, "Local offline repair planner fallback engaged.");

      if (!chatUrl) {
        fallbackReason = "Local chat engine is not configured.";
      } else if (!isLocalEngineUrl(chatUrl) && strictLocalInference) {
        fallbackReason = "Local-only repair planning rejected a non-local chat engine URL.";
      } else {
        const planningSystemPrompt = buildGovernedModelSystemPrompt({
          role: capsule.prompt_contract?.role ?? "You are Model running fully offline on Gauss.",
          directives: [
            "Return ONLY valid JSON object with keys: risk, summary, touched_files, validation_plan, unified_diff, scope_reason.",
            "touched_files must stay within the allowed batch files.",
            "unified_diff must be a single string in unified diff format and may be empty if you must refuse.",
            "Do not return markdown fences or prose outside the JSON object.",
          ],
        });
        const planningUserPrompt = [
          `Repair batch: ${JSON.stringify(batch)}`,
          `Pairing contract: ${JSON.stringify(pairing)}`,
          `Prompt contract: ${JSON.stringify(capsule.prompt_contract ?? {})}`,
          `System flow: ${JSON.stringify(capsule.system_flow ?? [])}`,
          `Power state: ${JSON.stringify(powerState)}`,
          `Allowed files: ${JSON.stringify(allowedTargets)}`,
          `File previews: ${JSON.stringify(fileContexts)}`,
        ].join("\n\n");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const apiKey = resolveLocalEngineApiKey();
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }
        const plannerPayload = {
          model: profile.model,
          temperature: Math.min(profile.temperature, 0.1),
          max_tokens: Math.min(profile.maxTokens, 1_200),
          messages: [
            { role: "system", content: planningSystemPrompt },
            { role: "user", content: planningUserPrompt },
          ],
        };

        opsCommandRuntime.notePlanner({ request: true });
        try {
          const plannerResult = await requestPlannerWithRetry(chatUrl, headers, plannerPayload);
          plannerLatencyMs = plannerResult.latencyMs;
          opsCommandRuntime.notePlanner({ latencyMs: plannerResult.latencyMs });
          if (plannerResult.status < 200 || plannerResult.status >= 300) {
            registerPlannerFailure();
            opsCommandRuntime.notePlanner({ failure: true });
            fallbackReason = `Planner HTTP ${plannerResult.status}`;
          } else {
            let parsedEnvelope: Record<string, unknown> | null = null;
            try {
              parsedEnvelope = JSON.parse(plannerResult.rawText) as Record<string, unknown>;
            } catch {
              parsedEnvelope = null;
            }
            const content = parsedEnvelope ? extractChatContent(parsedEnvelope) : null;
            const parsedProposal = content
              ? parseOfflineRepairProposal(content, allowedTargets, batch.validatorSequence)
              : null;
            if (parsedProposal) {
              proposal = parsedProposal;
              plannerMode = "external-model";
              resetPlannerCircuit();
            } else {
              registerPlannerFailure();
              opsCommandRuntime.notePlanner({ failure: true, parseFailure: true });
              fallbackReason = content
                ? "Planner output did not satisfy the bounded offline repair schema."
                : "Planner returned no parseable content.";
            }
          }
        } catch (error) {
          registerPlannerFailure();
          opsCommandRuntime.notePlanner({ failure: true });
          fallbackReason = error instanceof Error ? error.message : String(error);
        }
      }

      if (fallbackReason) {
        proposal = buildFallbackOfflineRepairProposal(batch, fallbackReason);
      }

      const validatorSequence = proposal.validation_plan.length > 0 ? proposal.validation_plan : batch.validatorSequence;
      const validation = runValidators
        ? await runValidatorSequence(validatorSequence)
        : {
          passed: true,
          failedCommand: null,
          results: [] as ValidatorResult[],
        };

      const artifact: OfflineRepairArtifact = {
        generated_at: new Date().toISOString(),
        capsule_generated_at: capsule.generated_at,
        batch,
        pairing,
        planner: {
          mode: plannerMode,
          model: profile.model,
          profile: profile.profile,
          reason: profile.reason,
          chat_url: chatUrl,
          latency_ms: plannerLatencyMs,
          fallback_reason: fallbackReason,
        },
        proposal,
        validation: {
          scope: "workspace-baseline",
          requested: runValidators,
          sequence: validatorSequence,
          passed: validation.passed,
          failed_command: validation.failedCommand,
          results: validation.results,
        },
      };
      const artifactPath = writeOfflineRepairArtifact(
        deps.offlineRepairArtifactsDir ?? DEFAULT_OFFLINE_REPAIR_ARTIFACTS_DIR,
        batch.batchId,
        artifact,
      );

      res.status(201).json({
        capsule_generated_at: capsule.generated_at,
        batch,
        pairing,
        planner: artifact.planner,
        proposal,
        validation: artifact.validation,
        artifact_path: artifactPath,
      });
    }),
  );
}
