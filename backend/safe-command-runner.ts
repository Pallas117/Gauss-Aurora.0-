import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { extractFirstJsonObject } from "./model-command-bridge.js";

export type SafeCommandRisk = "low" | "medium" | "high";

export interface SafeCommandPlan {
  executable: string;
  args: string[];
  reason: string | null;
  confidence: number | null;
  risk: SafeCommandRisk;
}

export interface SafeCommandApproval {
  approvalToken: string;
  approvalTokenHash: string;
  expiresAt: string;
  proposalId: string;
}

export interface SafeCommandProposal {
  proposalId: string;
  requestedBy: string | null;
  promptDigest: string;
  createdAt: string;
  expiresAt: string;
  plan: SafeCommandPlan;
  commandPreview: string;
}

export interface SafeCommandValidationResult {
  ok: boolean;
  reason: string | null;
}

export interface SafeCommandExecutionResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  commandPreview: string;
}

const DEFAULT_SAFE_COMMAND_ALLOWLIST = [
  "pmset",
  "uptime",
  "df",
  "vm_stat",
  "sysctl",
  "system_profiler",
  "networksetup",
  "ioreg",
  "lsof",
  "ps",
] as const;

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_APPROVALS = 300;
const DEFAULT_MAX_OUTPUT_BYTES = 32_768;
const DEFAULT_TIMEOUT_MS = 12_000;

function parseConfidence(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num));
}

function parseRisk(value: unknown): SafeCommandRisk {
  if (typeof value !== "string") return "medium";
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function normalizeExecutable(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeArg(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 180) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) return null;
  return trimmed;
}

function quoteArg(arg: string): string {
  if (/^[a-zA-Z0-9._:=+/@-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clamp(value: unknown, fallback: number, low: number, high: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(low, Math.min(high, Math.round(num)));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function formatCommandPreview(plan: SafeCommandPlan): string {
  const renderedArgs = plan.args.map(quoteArg).join(" ");
  return renderedArgs ? `${plan.executable} ${renderedArgs}` : plan.executable;
}

export function parseSafeCommandPlan(input: string | Record<string, unknown>): SafeCommandPlan | null {
  let parsedObject: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    const raw = input.trim();
    const maybeJson = raw.startsWith("{") ? raw : extractFirstJsonObject(raw);
    if (!maybeJson) return null;
    try {
      parsedObject = asObject(JSON.parse(maybeJson));
    } catch {
      parsedObject = null;
    }
  } else {
    parsedObject = asObject(input);
  }
  if (!parsedObject) return null;

  const executable = normalizeExecutable(parsedObject.executable) ?? normalizeExecutable(parsedObject.command);
  if (!executable) return null;
  const rawArgs = Array.isArray(parsedObject.args) ? parsedObject.args : [];
  const args = rawArgs
    .slice(0, 24)
    .map((value) => sanitizeArg(value))
    .filter((value): value is string => Boolean(value));
  const reason =
    typeof parsedObject.reason === "string" && parsedObject.reason.trim().length > 0
      ? parsedObject.reason.trim().slice(0, 600)
      : null;

  return {
    executable,
    args,
    reason,
    confidence: parseConfidence(parsedObject.confidence),
    risk: parseRisk(parsedObject.risk),
  };
}

export function resolveSafeCommandAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = (env.ORCHESTRATOR_SAFE_COMMAND_ALLOWLIST ?? "").trim();
  const list = configured
    ? configured.split(",").map((part) => part.trim()).filter(Boolean)
    : [...DEFAULT_SAFE_COMMAND_ALLOWLIST];
  return new Set(
    list
      .map((item) => item.toLowerCase())
      .filter((item) => /^[a-z0-9._-]{1,64}$/.test(item)),
  );
}

export function validateSafeCommandPlan(
  plan: SafeCommandPlan,
  allowlist: Set<string>,
): SafeCommandValidationResult {
  const executable = normalizeExecutable(plan.executable);
  if (!executable) {
    return { ok: false, reason: "Executable is missing or malformed" };
  }
  if (!allowlist.has(executable.toLowerCase())) {
    return { ok: false, reason: `Executable '${executable}' is not on the safe allowlist` };
  }
  if (!Array.isArray(plan.args) || plan.args.length > 24) {
    return { ok: false, reason: "Argument list exceeds safety limits" };
  }
  for (const arg of plan.args) {
    if (!sanitizeArg(arg)) {
      return { ok: false, reason: "One or more command arguments failed validation" };
    }
  }
  return { ok: true, reason: null };
}

type VaultEntry = {
  proposal: SafeCommandProposal;
  requestedBy: string | null;
  expiresAtMs: number;
};

export class SafeCommandApprovalVault {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => Date;
  private readonly entries = new Map<string, VaultEntry>();

  constructor(
    options: {
      ttlMs?: number;
      maxEntries?: number;
      now?: () => Date;
    } = {},
  ) {
    this.ttlMs = Math.max(5_000, options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS);
    this.maxEntries = Math.max(32, options.maxEntries ?? DEFAULT_MAX_APPROVALS);
    this.nowFn = options.now ?? (() => new Date());
  }

  private prune(nowMs: number): void {
    for (const [token, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(token);
      }
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  issue(proposal: SafeCommandProposal): SafeCommandApproval {
    const nowMs = this.nowFn().getTime();
    this.prune(nowMs);
    const rawToken = `${proposal.proposalId}.${randomUUID().replace(/-/g, "")}`;
    const expiresAtMs = nowMs + this.ttlMs;
    this.entries.set(rawToken, {
      proposal,
      requestedBy: proposal.requestedBy,
      expiresAtMs,
    });
    return {
      approvalToken: rawToken,
      approvalTokenHash: sha256(rawToken),
      expiresAt: new Date(expiresAtMs).toISOString(),
      proposalId: proposal.proposalId,
    };
  }

  peek(token: string, requestedBy: string | null): { proposal: SafeCommandProposal } | null {
    const nowMs = this.nowFn().getTime();
    this.prune(nowMs);
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(token);
      return null;
    }
    if (entry.requestedBy && requestedBy && entry.requestedBy !== requestedBy) {
      return null;
    }
    return { proposal: entry.proposal };
  }

  consume(token: string, requestedBy: string | null): { proposal: SafeCommandProposal } | null {
    const viewed = this.peek(token, requestedBy);
    if (!viewed) return null;
    this.entries.delete(token);
    return viewed;
  }
}

export function buildSafeCommandProposal(input: {
  plan: SafeCommandPlan;
  prompt: string;
  requestedBy: string | null;
  now?: () => Date;
  approvalTtlMs?: number;
}): SafeCommandProposal {
  const now = input.now ? input.now() : new Date();
  const ttlMs = Math.max(5_000, input.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS);
  return {
    proposalId: randomUUID(),
    requestedBy: input.requestedBy,
    promptDigest: sha256(input.prompt.slice(0, 4_000)),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    plan: input.plan,
    commandPreview: formatCommandPreview(input.plan),
  };
}

export async function runSafeCommand(
  plan: SafeCommandPlan,
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
  } = {},
): Promise<SafeCommandExecutionResult> {
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  const maxOutputBytes = clamp(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1_024, 131_072);
  const startedAt = (options.now ?? (() => new Date()))();
  const child = spawn(plan.executable, [...plan.args], {
    shell: false,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  });

  let stdoutSize = 0;
  let stderrSize = 0;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;

  const appendChunk = (chunk: Buffer | string, target: "stdout" | "stderr"): void => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    if (!text) return;
    const bytes = Buffer.byteLength(text);
    if (target === "stdout") {
      if (stdoutSize < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutSize;
        const slice = Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
        stdout += slice;
        stdoutSize += Buffer.byteLength(slice);
      } else {
        truncated = true;
      }
    } else {
      if (stderrSize < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrSize;
        const slice = Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
        stderr += slice;
        stderrSize += Buffer.byteLength(slice);
      } else {
        truncated = true;
      }
    }
    if (bytes > 0 && ((target === "stdout" && stdoutSize >= maxOutputBytes) || (target === "stderr" && stderrSize >= maxOutputBytes))) {
      truncated = true;
    }
  };

  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 400);
  }, timeoutMs);

  if (child.stdout) {
    child.stdout.on("data", (chunk) => appendChunk(chunk as Buffer | string, "stdout"));
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => appendChunk(chunk as Buffer | string, "stderr"));
  }

  const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("error", (error) => {
      appendChunk(String(error instanceof Error ? error.message : error), "stderr");
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(killTimer);

  const durationMs = Date.now() - startedAt.getTime();
  return {
    ok: !timedOut && exit.code === 0,
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    durationMs: Math.max(0, durationMs),
    stdout: stdout.slice(0, maxOutputBytes),
    stderr: stderr.slice(0, maxOutputBytes),
    truncated,
    commandPreview: formatCommandPreview(plan),
  };
}
