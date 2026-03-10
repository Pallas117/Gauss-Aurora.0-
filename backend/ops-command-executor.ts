import type { OpsCommandType } from "./deepseek-command-bridge.js";
import type {
  CanonicalSpaceWeatherPoint,
  NowcastInferenceResponse,
  SourceStatus,
} from "./types.js";

type InferNowcastFn = (input: {
  horizonMinutes: number;
  sequence: CanonicalSpaceWeatherPoint[];
}) => Promise<NowcastInferenceResponse>;

export interface OpsCommandExecutorDeps {
  inferNowcast: InferNowcastFn;
  getLatestCanonical: () => CanonicalSpaceWeatherPoint | null;
  getSourceStatus: () => SourceStatus[];
  fetchFn?: typeof fetch;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export interface OpsCommandExecutionOptions {
  simulate?: boolean;
  idempotencyKey?: string | null;
  onPassApiRetry?: () => void;
  onPassApiCircuitOpen?: () => void;
}

export interface OpsCommandExecutionResult {
  executed: boolean;
  commandType: OpsCommandType;
  mode: "live" | "deferred";
  detail: string;
  output?: unknown;
}

type PassApiCircuitState = {
  consecutiveFailures: number;
  openUntilMs: number;
};

const passApiCircuit: PassApiCircuitState = {
  consecutiveFailures: 0,
  openUntilMs: 0,
};

function asFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampInt(value: unknown, fallback: number, low: number, high: number): number {
  const num = asFiniteNumber(value);
  if (num == null) return fallback;
  return Math.max(low, Math.min(high, Math.round(num)));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseEnvBool(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function asCommandText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 120);
}

function looksCanonicalPoint(value: unknown): value is CanonicalSpaceWeatherPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.timestamp === "string" &&
    typeof point.solarWind === "object" &&
    point.solarWind !== null &&
    typeof point.magneticField === "object" &&
    point.magneticField !== null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function resetPassApiCircuit(): void {
  passApiCircuit.consecutiveFailures = 0;
  passApiCircuit.openUntilMs = 0;
}

function registerPassApiFailure(
  env: NodeJS.ProcessEnv,
  options: OpsCommandExecutionOptions,
): void {
  const threshold = clampInt(env.ORCHESTRATOR_PASS_API_CIRCUIT_FAILURE_THRESHOLD, 3, 1, 20);
  const cooldownMs = clampInt(env.ORCHESTRATOR_PASS_API_CIRCUIT_COOLDOWN_MS, 30_000, 1_000, 600_000);
  passApiCircuit.consecutiveFailures += 1;
  if (passApiCircuit.consecutiveFailures >= threshold) {
    passApiCircuit.openUntilMs = Date.now() + cooldownMs;
    options.onPassApiCircuitOpen?.();
  }
}

async function requestJsonWithRetry(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  env: NodeJS.ProcessEnv,
  options: OpsCommandExecutionOptions,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; text: string }> {
  const retries = clampInt(env.ORCHESTRATOR_PASS_API_RETRIES, 2, 0, 6);
  const retryDelayMs = clampInt(env.ORCHESTRATOR_PASS_API_RETRY_DELAY_MS, 250, 50, 5_000);

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchFn(url, init);
      const text = await response.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? JSON.parse(text) as Record<string, unknown> : {};
      } catch {
        json = {};
      }

      if (!response.ok && isRetriableStatus(response.status) && attempt < retries) {
        options.onPassApiRetry?.();
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      return {
        ok: response.ok,
        status: response.status,
        json,
        text,
      };
    } catch (error) {
      lastNetworkError = error;
      if (attempt < retries) {
        options.onPassApiRetry?.();
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw lastNetworkError;
    }
  }

  throw lastNetworkError ?? new Error("Pass API request failed");
}

async function executeTriggerNowcast(
  payload: Record<string, unknown>,
  deps: OpsCommandExecutorDeps,
  options: OpsCommandExecutionOptions,
): Promise<OpsCommandExecutionResult> {
  const horizonMinutes = clampInt(payload.horizonMinutes, 60, 5, 180);
  const providedSequence = Array.isArray(payload.sequence)
    ? payload.sequence.filter(looksCanonicalPoint)
    : [];
  const latest = deps.getLatestCanonical();

  const sequence = providedSequence.length > 0
    ? providedSequence
    : latest
      ? [latest]
      : [];

  if (sequence.length === 0) {
    return {
      executed: false,
      commandType: "trigger-nowcast",
      mode: "deferred",
      detail: "No canonical telemetry available for nowcast inference.",
    };
  }

  if (options.simulate) {
    return {
      executed: true,
      commandType: "trigger-nowcast",
      mode: "deferred",
      detail: `Simulation: nowcast would run with horizon=${horizonMinutes} and ${sequence.length} sequence point(s).`,
      output: {
        horizonMinutes,
        sequence_count: sequence.length,
      },
    };
  }

  const nowcast = await deps.inferNowcast({
    horizonMinutes,
    sequence,
  });

  return {
    executed: true,
    commandType: "trigger-nowcast",
    mode: "live",
    detail: `Nowcast generated with horizon=${horizonMinutes} minutes and ${sequence.length} sequence point(s).`,
    output: nowcast,
  };
}

async function executeSchedulePass(
  payload: Record<string, unknown>,
  deps: OpsCommandExecutorDeps,
  options: OpsCommandExecutionOptions,
): Promise<OpsCommandExecutionResult> {
  const env = deps.env ?? process.env;
  const passApiEnabled = parseEnvBool(env.ORCHESTRATOR_PASS_API_ENABLED, false);
  if (!passApiEnabled) {
    return {
      executed: false,
      commandType: "schedule-pass",
      mode: "deferred",
      detail: "Pass API is disabled (set ORCHESTRATOR_PASS_API_ENABLED=true).",
    };
  }

  if (passApiCircuit.openUntilMs > Date.now()) {
    return {
      executed: false,
      commandType: "schedule-pass",
      mode: "deferred",
      detail: `Pass API circuit is open until ${new Date(passApiCircuit.openUntilMs).toISOString()}.`,
    };
  }

  const now = deps.now ? deps.now() : new Date();
  const aos =
    parseTimestamp(payload.aos) ??
    new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const los =
    parseTimestamp(payload.los) ??
    new Date(Date.parse(aos) + 12 * 60 * 1000).toISOString();

  const target = asCommandText(payload.target, "DSCOVR");
  const station = asCommandText(payload.station, "GAUSS-GS-1");
  const priority = clampInt(payload.priority, 6, 1, 10);

  const bind = (env.ORCHESTRATOR_PASS_API_BIND ?? "127.0.0.1:8091").trim();
  const baseUrl = (env.ORCHESTRATOR_PASS_API_BASE_URL ?? `http://${bind}`).trim().replace(/\/+$/, "");
  const planUrl = (env.ORCHESTRATOR_PASS_API_PLAN_URL ?? `${baseUrl}/passes/plan`).trim();
  const fetchFn = deps.fetchFn ?? fetch;

  const planRequest = {
    target,
    station,
    aos,
    los,
    priority,
    idempotency_key: options.idempotencyKey ?? undefined,
  };

  if (options.simulate) {
    return {
      executed: true,
      commandType: "schedule-pass",
      mode: "deferred",
      detail: "Simulation: pass would be planned and scheduled via pass API.",
      output: {
        plan_url: planUrl,
        plan_request: planRequest,
      },
    };
  }

  try {
    const planResp = await requestJsonWithRetry(
      planUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planRequest),
        signal: AbortSignal.timeout(10_000),
      },
      fetchFn,
      env,
      options,
    );

    if (!planResp.ok) {
      if (isRetriableStatus(planResp.status)) {
        registerPassApiFailure(env, options);
      }
      const detail = typeof planResp.json.message === "string"
        ? planResp.json.message
        : planResp.text.slice(0, 240) || `HTTP ${planResp.status}`;
      return {
        executed: false,
        commandType: "schedule-pass",
        mode: "deferred",
        detail: `Pass planning failed: ${detail}`,
        output: planResp.json,
      };
    }

    const passId = typeof planResp.json.pass_id === "string" ? planResp.json.pass_id : null;
    if (!passId) {
      registerPassApiFailure(env, options);
      return {
        executed: false,
        commandType: "schedule-pass",
        mode: "deferred",
        detail: "Pass API response did not include pass_id.",
        output: planResp.json,
      };
    }

    const scheduleUrl = `${baseUrl}/passes/${encodeURIComponent(passId)}/schedule`;
    const scheduleResp = await requestJsonWithRetry(
      scheduleUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator: asCommandText(payload.operator, "deepseek-model"),
          idempotency_key: options.idempotencyKey ?? undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      },
      fetchFn,
      env,
      options,
    );

    if (!scheduleResp.ok) {
      if (isRetriableStatus(scheduleResp.status)) {
        registerPassApiFailure(env, options);
      }
      return {
        executed: true,
        commandType: "schedule-pass",
        mode: "deferred",
        detail: `Pass planned (${passId}) but scheduling failed (HTTP ${scheduleResp.status}).`,
        output: {
          planned: planResp.json,
          schedule_error: scheduleResp.json,
        },
      };
    }

    resetPassApiCircuit();
    return {
      executed: true,
      commandType: "schedule-pass",
      mode: "live",
      detail: `Pass ${passId} planned and scheduled.`,
      output: {
        planned: planResp.json,
        scheduled: scheduleResp.json,
      },
    };
  } catch (error) {
    registerPassApiFailure(env, options);
    return {
      executed: false,
      commandType: "schedule-pass",
      mode: "deferred",
      detail: `Pass scheduling failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function executeHealthCheck(
  deps: OpsCommandExecutorDeps,
  options: OpsCommandExecutionOptions,
): OpsCommandExecutionResult {
  const now = deps.now ? deps.now() : new Date();
  const sourceStatus = deps.getSourceStatus();
  const degraded = sourceStatus.filter((source) => !source.healthy).map((source) => source.source);
  const detail = degraded.length > 0
    ? `Health check logged: degraded sources (${degraded.join(", ")}).`
    : "Health check logged: all sources healthy.";

  return {
    executed: true,
    commandType: "log-health-check",
    mode: options.simulate ? "deferred" : "live",
    detail: options.simulate ? `Simulation: ${detail}` : detail,
    output: {
      timestamp: now.toISOString(),
      total_sources: sourceStatus.length,
      degraded_sources: degraded,
    },
  };
}

export async function executeOpsCommand(
  commandType: OpsCommandType,
  payloadInput: unknown,
  deps: OpsCommandExecutorDeps,
  options: OpsCommandExecutionOptions = {},
): Promise<OpsCommandExecutionResult> {
  const payload = asRecord(payloadInput);
  if (commandType === "trigger-nowcast") {
    return executeTriggerNowcast(payload, deps, options);
  }
  if (commandType === "schedule-pass") {
    return executeSchedulePass(payload, deps, options);
  }
  return executeHealthCheck(deps, options);
}
