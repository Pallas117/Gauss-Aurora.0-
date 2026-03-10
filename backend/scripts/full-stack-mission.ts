import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {
  computeFinalStatus,
  findTriage,
  summarizeChecks,
  writeReportArtifacts,
  type MissionCheck,
  type MissionConfig,
  type MissionReport,
} from "./full-stack-report.js";
import { envValue, isTruthy, loadMissionConfig } from "./full-stack-mission/setup.js";

const HELP_TEXT = `
Full-stack mission validation harness.

Usage:
  npm run test:fullstack
  npm run test:fullstack -- --help

Environment:
  FRONTEND_BASE_URL (default: http://127.0.0.1:8080)
  BACKEND_BASE_URL  (default: http://127.0.0.1:3001)
  GAUSS_BRAIN_URL   (default: http://127.0.0.1:8089/v1)
  GAUSS_RAG_URL     (optional; e.g. http://127.0.0.1:3002)
  FULLSTACK_RUN_ID  (optional; auto UUID if absent)
  FULLSTACK_WRITE_MODE (default: controlled)
  FULLSTACK_CLEANUP (default: true)
  FULLSTACK_SKIP_UI_E2E (default: false)
  FULLSTACK_SKIP_UI_MOBILE (default: false)
  RBAC_* credentials (required for RBAC + role/token checks)
  ORCHESTRATOR_INGEST_API_TOKEN (optional; when set, Phase 4 validates POST /api/ingest/telemetry/packets)
`;

type HttpResult = {
  status: number;
  body: unknown;
  raw: string;
};

type RoleName = "viewer" | "operator" | "admin";

type RoleTokens = Partial<Record<RoleName, string>>;

type ControlledWriteContext = {
  runId: string;
  source: string;
  streamTag: string;
  observedAtIso: string;
  windowStartIso: string;
  windowEndIso: string;
};

function formatNetworkError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const message = (error as { message?: string }).message ?? "unknown error";
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return message;
  }
  const code = (cause as { code?: string }).code ?? "unknown-code";
  const errno = (cause as { errno?: string | number }).errno ?? "unknown-errno";
  const address = (cause as { address?: string }).address ?? "unknown-address";
  const port = (cause as { port?: string | number }).port ?? "unknown-port";
  return `${message} (cause code=${code}, errno=${errno}, address=${address}, port=${port})`;
}

function samplePayload(runId: string, observedAtIso: string): Record<string, unknown> {
  return {
    timestamp: observedAtIso,
    source: "test_harness",
    solarWind: {
      speed: 420,
      density: 6,
      dynamicPressure: 2.7,
    },
    velocity: {
      x: -420,
      y: 3,
      z: 1,
      magnitude: 420,
    },
    magneticField: {
      x: 3.1,
      y: -1.7,
      z: -5.2,
      bt: 6.3,
    },
    indices: {
      kp: 4,
      dst: -40,
    },
    meta: {
      runId,
      stream: "mission_fullstack",
      source: "test_harness",
    },
  };
}

function runCommand(command: string): {
  passed: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
} {
  const started = Date.now();
  const proc = spawnSync("bash", ["-lc", command], {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  return {
    passed: proc.status === 0,
    exitCode: proc.status,
    output,
    durationMs: Date.now() - started,
  };
}

async function requestJson(url: string, init?: RequestInit, timeoutMs = 15000): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`[http] fetch failed for ${url}: ${formatNetworkError(error)}`);
  }
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return { status: response.status, body, raw };
}

function safeOutput(output: string, limit = 1200): string {
  return output.length > limit ? `${output.slice(0, limit)}\n...<truncated>` : output;
}

function createSupabaseAdminClient(): SupabaseClient {
  const url = envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loginWithPassword(email: string, password: string): Promise<string> {
  const supabaseUrl = envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
  const anonKey = envValue("VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_ANON_KEY/VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const result = await requestJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const token = (result.body as { access_token?: string } | null)?.access_token;
  if (result.status !== 200 || !token) {
    throw new Error(
      `Auth failed for ${email} (HTTP ${result.status}): ${
        typeof result.body === "string" ? result.body : JSON.stringify(result.body)
      }`,
    );
  }
  return token;
}

async function resolveRoleTokens(): Promise<RoleTokens> {
  const roles: Array<{
    role: RoleName;
    tokenEnv: string;
    emailEnv: string;
    passwordEnv: string;
  }> = [
    {
      role: "viewer",
      tokenEnv: "RBAC_VIEWER_TOKEN",
      emailEnv: "RBAC_VIEWER_EMAIL",
      passwordEnv: "RBAC_VIEWER_PASSWORD",
    },
    {
      role: "operator",
      tokenEnv: "RBAC_OPERATOR_TOKEN",
      emailEnv: "RBAC_OPERATOR_EMAIL",
      passwordEnv: "RBAC_OPERATOR_PASSWORD",
    },
    {
      role: "admin",
      tokenEnv: "RBAC_ADMIN_TOKEN",
      emailEnv: "RBAC_ADMIN_EMAIL",
      passwordEnv: "RBAC_ADMIN_PASSWORD",
    },
  ];

  const tokens: RoleTokens = {};
  for (const entry of roles) {
    const direct = envValue(entry.tokenEnv);
    if (direct) {
      tokens[entry.role] = direct;
      continue;
    }
    const email = envValue(entry.emailEnv);
    const password = envValue(entry.passwordEnv);
    if (!email || !password) {
      continue;
    }
    tokens[entry.role] = await loginWithPassword(email, password);
  }
  return tokens;
}

async function checkWebSocket(
  wsUrl: string,
  token: string,
  expectedTopic: string,
  timeoutMs = 10000,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, detail: `Timeout after ${timeoutMs}ms waiting for websocket message.` });
    }, timeoutMs);

    const url = new URL(wsUrl);
    url.searchParams.set("token", token);
    const socket = new WebSocket(url.toString());

    socket.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      try {
        const parsed = JSON.parse(raw) as { topic?: string; payload?: { stream?: string } };
        if (parsed.topic === "system" && parsed.payload?.stream === expectedTopic) {
          clearTimeout(timer);
          socket.close();
          resolve({ ok: true, detail: `Received system stream handshake for ${expectedTopic}.` });
        }
      } catch {
        // Ignore malformed frames while waiting for handshake.
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `WebSocket error: ${error.message}` });
    });

    socket.on("close", () => {
      clearTimeout(timer);
    });
  });
}

function buildControlledWriteContext(runId: string): ControlledWriteContext {
  const base = new Date("2099-01-01T00:00:00.000Z");
  base.setUTCSeconds((base.getUTCSeconds() + Math.floor(Math.random() * 40)) % 60);
  const observedAtIso = base.toISOString();
  const start = new Date(Date.parse(observedAtIso) - 2 * 60 * 1000).toISOString();
  const end = new Date(Date.parse(observedAtIso) + 2 * 60 * 1000).toISOString();
  return {
    runId,
    source: "test_harness",
    streamTag: "mission_fullstack",
    observedAtIso,
    windowStartIso: start,
    windowEndIso: end,
  };
}

async function controlledWriteValidation(
  supabase: SupabaseClient,
  context: ControlledWriteContext,
): Promise<{ ok: boolean; detail: string; cleanupDetail?: string }> {
  const payload = samplePayload(context.runId, context.observedAtIso);
  const payloadWithTag = {
    ...payload,
    meta: {
      ...(payload.meta as Record<string, unknown>),
      stream: context.streamTag,
    },
  };

  const insertTagged = await supabase.rpc("ingest_raw_sample", {
    source: context.source,
    stream: context.streamTag,
    observed_at: context.observedAtIso,
    payload: payloadWithTag,
  });
  if (insertTagged.error) {
    return { ok: false, detail: `Failed tagged ingest_raw_sample: ${insertTagged.error.message}` };
  }

  const insertCanonical = await supabase.rpc("ingest_raw_sample", {
    source: context.source,
    stream: "canonical",
    observed_at: context.observedAtIso,
    payload: payloadWithTag,
  });
  if (insertCanonical.error) {
    return { ok: false, detail: `Failed canonical ingest_raw_sample: ${insertCanonical.error.message}` };
  }

  const clean = await supabase.rpc("clean_raw_window", {
    start_ts: context.windowStartIso,
    end_ts: context.windowEndIso,
  });
  if (clean.error) {
    return { ok: false, detail: `clean_raw_window failed: ${clean.error.message}` };
  }

  const nowcast = await supabase.rpc("generate_nowcast_5s", {
    start_ts: context.windowStartIso,
    end_ts: context.windowEndIso,
  });
  if (nowcast.error) {
    return { ok: false, detail: `generate_nowcast_5s failed: ${nowcast.error.message}` };
  }

  const rawCheck = await supabase
    .from("sw_raw_samples")
    .select("id,source,stream")
    .eq("source", context.source)
    .eq("stream", context.streamTag)
    .eq("observed_at", context.observedAtIso)
    .limit(1);
  if (rawCheck.error || !rawCheck.data || rawCheck.data.length === 0) {
    return { ok: false, detail: "Tagged sw_raw_samples row missing after controlled ingest." };
  }

  const cleanCheck = await supabase
    .from("sw_clean_samples")
    .select("id,quality_flags,uncertainty")
    .eq("source", context.source)
    .eq("stream", "canonical")
    .eq("observed_at", context.observedAtIso)
    .limit(1);
  if (cleanCheck.error || !cleanCheck.data || cleanCheck.data.length === 0) {
    return { ok: false, detail: "sw_clean_samples row missing after clean_raw_window." };
  }
  const cleanRow = cleanCheck.data[0] as { quality_flags?: unknown; uncertainty?: unknown };
  if (!cleanRow.quality_flags || !cleanRow.uncertainty) {
    return { ok: false, detail: "sw_clean_samples quality_flags/uncertainty missing." };
  }

  const nowcastCheck = await supabase
    .from("sw_nowcast_5s")
    .select("timestamp,quality_flags,uncertainty,point")
    .gte("timestamp", context.windowStartIso)
    .lte("timestamp", context.windowEndIso)
    .contains("point", { meta: { runId: context.runId } });
  if (nowcastCheck.error || !nowcastCheck.data || nowcastCheck.data.length === 0) {
    return { ok: false, detail: "sw_nowcast_5s rows missing for controlled run window." };
  }

  const hasMissingFields = nowcastCheck.data.some((row) => !row.quality_flags || !row.uncertainty);
  if (hasMissingFields) {
    return { ok: false, detail: "sw_nowcast_5s has rows missing quality_flags/uncertainty." };
  }

  let cleanupDetail = "cleanup skipped";
  if (isTruthy(envValue("FULLSTACK_CLEANUP")) || envValue("FULLSTACK_CLEANUP") === null) {
    const cleanupRawTagged = await supabase
      .from("sw_raw_samples")
      .delete()
      .eq("source", context.source)
      .eq("stream", context.streamTag)
      .eq("observed_at", context.observedAtIso)
      .select("id");

    const cleanupRawCanonical = await supabase
      .from("sw_raw_samples")
      .delete()
      .eq("source", context.source)
      .eq("stream", "canonical")
      .eq("observed_at", context.observedAtIso)
      .select("id");

    const cleanupClean = await supabase
      .from("sw_clean_samples")
      .delete()
      .eq("source", context.source)
      .eq("stream", "canonical")
      .eq("observed_at", context.observedAtIso)
      .select("id");

    const cleanupNowcast = await supabase
      .from("sw_nowcast_5s")
      .delete()
      .gte("timestamp", context.windowStartIso)
      .lte("timestamp", context.windowEndIso)
      .contains("point", { meta: { runId: context.runId } })
      .select("timestamp");

    if (cleanupRawTagged.error || cleanupRawCanonical.error || cleanupClean.error || cleanupNowcast.error) {
      return {
        ok: false,
        detail: "Controlled write succeeded but cleanup failed.",
        cleanupDetail: `raw_tagged=${cleanupRawTagged.error?.message ?? "ok"} raw_canonical=${
          cleanupRawCanonical.error?.message ?? "ok"
        } clean=${cleanupClean.error?.message ?? "ok"} nowcast=${cleanupNowcast.error?.message ?? "ok"}`,
      };
    }

    cleanupDetail = `cleanup deleted raw_tagged=${cleanupRawTagged.data?.length ?? 0}, raw_canonical=${
      cleanupRawCanonical.data?.length ?? 0
    }, clean=${cleanupClean.data?.length ?? 0}, nowcast=${cleanupNowcast.data?.length ?? 0}`;
  }

  return {
    ok: true,
    detail: `Controlled writes validated for runId=${context.runId}.`,
    cleanupDetail,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const runId = envValue("FULLSTACK_RUN_ID") ?? randomUUID();
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();

  const config = loadMissionConfig();

  const checks: MissionCheck[] = [];

  const pushCommandCheck = (
    phase: string,
    name: string,
    command: string,
    mandatory: boolean,
    remediation?: string,
  ) => {
    const result = runCommand(command);
    checks.push({
      phase,
      name,
      mandatory,
      status: result.passed ? "PASS" : mandatory ? "FAIL" : "WARN",
      command,
      durationMs: result.durationMs,
      detail: safeOutput(result.output),
      remediation,
      rerunCommand: command,
    });
  };

  // Phase 0
  pushCommandCheck("Phase 0", "Validate runtime versions", "node -v && npm -v && python3 --version", true);
  pushCommandCheck("Phase 0", "Backend env sanity", "npm run check:backend-env", true);
  pushCommandCheck(
    "Phase 0",
    "Tailscale secure posture",
    "npm run dev:tailscale:doctor",
    true,
    "Run `npm run dev:tailscale:doctor:fix` then rerun mission test.",
  );
  pushCommandCheck(
    "Phase 0",
    "Port ownership (8080/3001/8089)",
    "lsof -nP -iTCP:8080 -sTCP:LISTEN || true; lsof -nP -iTCP:3001 -sTCP:LISTEN || true; lsof -nP -iTCP:8089 -sTCP:LISTEN || true",
    true,
  );

  // Phase 1
  const backendHealthStart = Date.now();
  try {
    const health = await requestJson(`${config.backendUrl}/health`);
    checks.push({
      phase: "Phase 1",
      name: "Backend health gate",
      mandatory: true,
      status: health.status === 200 ? "PASS" : "FAIL",
      command: `GET ${config.backendUrl}/health`,
      durationMs: Date.now() - backendHealthStart,
      detail: `HTTP ${health.status}`,
      remediation: "Start backend: npm run dev:proxy",
      rerunCommand: "npm run dev:proxy",
    });
  } catch (error) {
    checks.push({
      phase: "Phase 1",
      name: "Backend health gate",
      mandatory: true,
      status: "FAIL",
      command: `GET ${config.backendUrl}/health`,
      durationMs: Date.now() - backendHealthStart,
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Start backend: npm run dev:proxy",
      rerunCommand: "npm run dev:proxy",
    });
  }

  const frontendStart = Date.now();
  try {
    const ui = await fetch(config.frontendUrl, { signal: AbortSignal.timeout(12000) });
    checks.push({
      phase: "Phase 1",
      name: "Frontend root gate",
      mandatory: true,
      status: ui.status === 200 ? "PASS" : "FAIL",
      command: `GET ${config.frontendUrl}/`,
      durationMs: Date.now() - frontendStart,
      detail: `HTTP ${ui.status}`,
      remediation: "Start frontend: npm run dev",
      rerunCommand: "npm run dev",
    });
  } catch (error) {
    checks.push({
      phase: "Phase 1",
      name: "Frontend root gate",
      mandatory: true,
      status: "FAIL",
      command: `GET ${config.frontendUrl}/`,
      durationMs: Date.now() - frontendStart,
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Start frontend: npm run dev",
      rerunCommand: "npm run dev",
    });
  }

  const brainStart = Date.now();
  try {
    const brain = await requestJson(
      `${config.brainUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "local-model",
          messages: [{ role: "user", content: "Ping" }],
        }),
      },
      20000,
    );
    checks.push({
      phase: "Phase 1",
      name: "Gauss Brain ping gate",
      mandatory: true,
      status: brain.status === 200 ? "PASS" : "FAIL",
      command: `POST ${config.brainUrl}/chat/completions`,
      durationMs: Date.now() - brainStart,
      detail: `HTTP ${brain.status}`,
      remediation: "Start Gauss Brain on port 8089 and verify /v1/chat/completions.",
    });
  } catch (error) {
    checks.push({
      phase: "Phase 1",
      name: "Gauss Brain ping gate",
      mandatory: true,
      status: "FAIL",
      command: `POST ${config.brainUrl}/chat/completions`,
      durationMs: Date.now() - brainStart,
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Start Gauss Brain on port 8089 and verify /v1/chat/completions.",
    });
  }

  // Phase 2
  pushCommandCheck("Phase 2", "TypeScript lint", "npm run lint", true);
  pushCommandCheck("Phase 2", "Backend unit/integration tests", "npm test", true);
  pushCommandCheck("Phase 2", "Production build", "npm run build", true);
  pushCommandCheck("Phase 2", "Security compliance map", "npm run check:security-compliance", true);
  pushCommandCheck("Phase 2", "Adherence audit", "npm run audit:adherence", true);

  // Phase 3
  pushCommandCheck("Phase 3", "RBAC smoke", "npm run test:rbac", true);

  let tokens: RoleTokens = {};
  try {
    tokens = await resolveRoleTokens();
  } catch (error) {
    checks.push({
      phase: "Phase 3",
      name: "Role token resolution",
      mandatory: true,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Set RBAC_VIEWER/OPERATOR/ADMIN token or email+password env vars.",
    });
  }

  const viewerToken = tokens.viewer;
  const operatorToken = tokens.operator;
  const adminToken = tokens.admin;

  const apiEndpoints = [
    "/api/feed/space-weather/5s?lookback=PT5M&limit=20",
    "/api/feed/space-weather/latest",
    "/api/feed/mms/reconnection?lookback=PT30M&limit=20",
    "/api/feed/mms/reconnection/latest",
    "/api/feed/aurora/map?projection=gsm",
    "/api/feed/sources/status",
  ];

  if (viewerToken) {
    for (const endpoint of apiEndpoints) {
      const started = Date.now();
      try {
        const res = await requestJson(`${config.backendUrl}${endpoint}`, {
          headers: {
            Authorization: `Bearer ${viewerToken}`,
          },
        });
        const isNoMmsYet =
          endpoint.includes("/api/feed/mms/reconnection/latest") &&
          res.status === 404 &&
          typeof res.body === "object" &&
          !!res.body &&
          /No MMS reconnection data yet/i.test(
            (res.body as { error?: string }).error ?? "",
          );

        checks.push({
          phase: "Phase 3",
          name: `API contract ${endpoint}`,
          mandatory: true,
          status: isNoMmsYet ? "WARN" : res.status === 200 ? "PASS" : "FAIL",
          command: `GET ${endpoint}`,
          durationMs: Date.now() - started,
          detail: isNoMmsYet ? `HTTP ${res.status} (no MMS sample yet)` : `HTTP ${res.status}`,
          remediation: "Verify backend service, auth token, and ingestion worker state.",
        });
      } catch (error) {
        checks.push({
          phase: "Phase 3",
          name: `API contract ${endpoint}`,
          mandatory: true,
          status: "FAIL",
          command: `GET ${endpoint}`,
          durationMs: Date.now() - started,
          detail: error instanceof Error ? error.message : String(error),
          remediation: "Verify backend service and auth token.",
        });
      }
    }
  } else {
    checks.push({
      phase: "Phase 3",
      name: "API contract checks (viewer)",
      mandatory: true,
      status: "FAIL",
      detail: "Viewer token unavailable. Set RBAC_VIEWER_TOKEN or viewer credentials.",
      remediation: "Set RBAC_VIEWER_TOKEN or RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD.",
    });
  }

  if (viewerToken) {
    const payload = {
      horizonMinutes: 30,
      sequence: [
        {
          timestamp: new Date().toISOString(),
          source: "fusion",
          rho: 5,
          velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
          magneticField: { x: 2, y: -1, z: -4, bt: 4.58 },
          electricField: { x: 0.1, y: 1.5, z: 0.2, ey: 1.5 },
          solarWind: { speed: 400, density: 5, dynamicPressure: 2.1 },
          indices: { kp: 3, dst: -20 },
          coupling: { newell: 1500, epsilon: 120000000000 },
          propagation: { l1DelaySeconds: 3600, etaEarthArrival: new Date().toISOString() },
          alerts: { stormTier: "watch", reason: "mission-fullstack-check" },
          quality: {
            outlier: false,
            stale: false,
            interpolated: false,
            extrapolated: false,
            lowConfidence: false,
          },
          uncertainty: {
            speed: { lower: 380, upper: 420, sigma: 10 },
            density: { lower: 4.4, upper: 5.6, sigma: 0.3 },
            bz: { lower: -4.8, upper: -3.2, sigma: 0.4 },
          },
        },
      ],
    };

    const viewerInfer = await requestJson(`${config.backendUrl}/api/ai/nowcast/infer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    checks.push({
      phase: "Phase 3",
      name: "Viewer forbidden on infer",
      mandatory: true,
      status: viewerInfer.status === 403 ? "PASS" : "FAIL",
      detail: `HTTP ${viewerInfer.status}`,
    });

    const viewerTrain = await requestJson(`${config.backendUrl}/api/ai/nowcast/train`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${viewerToken}`,
      },
    });
    checks.push({
      phase: "Phase 3",
      name: "Viewer forbidden on train",
      mandatory: true,
      status: viewerTrain.status === 403 ? "PASS" : "FAIL",
      detail: `HTTP ${viewerTrain.status}`,
    });

    if (operatorToken) {
      const operatorInfer = await requestJson(`${config.backendUrl}/api/ai/nowcast/infer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      checks.push({
        phase: "Phase 3",
        name: "Operator allowed infer",
        mandatory: true,
        status: operatorInfer.status === 200 ? "PASS" : "FAIL",
        detail: `HTTP ${operatorInfer.status}`,
      });

      const operatorTrain = await requestJson(`${config.backendUrl}/api/ai/nowcast/train`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operatorToken}`,
        },
      });
      checks.push({
        phase: "Phase 3",
        name: "Operator forbidden train",
        mandatory: true,
        status: operatorTrain.status === 403 ? "PASS" : "FAIL",
        detail: `HTTP ${operatorTrain.status}`,
      });
    } else {
      checks.push({
        phase: "Phase 3",
        name: "Operator role checks",
        mandatory: true,
        status: "FAIL",
        detail: "Operator token unavailable.",
      });
    }

    if (config.runTrainCheck) {
      if (!adminToken) {
        checks.push({
          phase: "Phase 3",
          name: "Admin train check",
          mandatory: true,
          status: "FAIL",
          detail: "RBAC_TEST_TRAIN=true but admin token unavailable.",
        });
      } else {
        const adminTrain = await requestJson(`${config.backendUrl}/api/ai/nowcast/train`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });
        checks.push({
          phase: "Phase 3",
          name: "Admin allowed train",
          mandatory: true,
          status: adminTrain.status === 200 ? "PASS" : "FAIL",
          detail: `HTTP ${adminTrain.status}`,
        });
      }
    } else {
      checks.push({
        phase: "Phase 3",
        name: "Admin train check",
        mandatory: false,
        status: "SKIP",
        detail: "Skipped by default. Set RBAC_TEST_TRAIN=true to enable.",
      });
    }
  }

  if (viewerToken) {
    const wsSpace = await checkWebSocket(
      config.backendUrl.replace(/^http/i, "ws") + "/ws/feed/space-weather",
      viewerToken,
      "space-weather",
    );
    checks.push({
      phase: "Phase 3",
      name: "WS space-weather auth+handshake",
      mandatory: false,
      status: wsSpace.ok ? "PASS" : "WARN",
      detail: wsSpace.detail,
    });

    const wsMms = await checkWebSocket(
      config.backendUrl.replace(/^http/i, "ws") + "/ws/feed/mms-reconnection",
      viewerToken,
      "mms-reconnection",
    );
    checks.push({
      phase: "Phase 3",
      name: "WS mms-reconnection auth+handshake",
      mandatory: false,
      status: wsMms.ok ? "PASS" : "WARN",
      detail: wsMms.detail,
    });
  }

  // Phase 4
  const ingestToken = envValue("ORCHESTRATOR_INGEST_API_TOKEN");
  if (ingestToken) {
    const ingestPayload = {
      run_id: runId,
      source: "ccsds-orchestrator",
      format: "ccsds-bin" as const,
      dictionary_id: "gauss-baseline-v1",
      packets: [
        {
          timestamp: new Date().toISOString(),
          apid: 900,
          seq_count: 1,
          payload_hex: "3F8000004000000000000000",
          canonical_point: {
            timestamp: new Date().toISOString(),
            solarWind: { speed: 400, density: 6 },
            magneticField: { z: -2.5 },
          },
          quality_flags: {
            crc_checked: false,
            crc_valid: null,
            missing_parameters: false,
          },
          uncertainty: { speed: { sigma: 8 }, density: { sigma: 0.6 }, bz: { sigma: 0.8 } },
        },
      ],
    };
    const ingestStart = Date.now();
    try {
      const ingestRes = await requestJson(
        `${config.backendUrl}/api/ingest/telemetry/packets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gauss-service-token": ingestToken,
            Authorization: `Bearer ${ingestToken}`,
          },
          body: JSON.stringify(ingestPayload),
        },
        15000,
      );
      const body = ingestRes.body as { accepted_count?: number; rejected_count?: number } | null;
      const hasShape =
        ingestRes.status === 200 &&
        typeof body?.accepted_count === "number" &&
        typeof body?.rejected_count === "number";
      checks.push({
        phase: "Phase 4",
        name: "Orchestrator ingest E2E (service token)",
        mandatory: true,
        status: hasShape ? "PASS" : "FAIL",
        command: "POST /api/ingest/telemetry/packets",
        durationMs: Date.now() - ingestStart,
        detail: hasShape
          ? `HTTP 200, accepted_count=${body!.accepted_count}, rejected_count=${body!.rejected_count}`
          : `HTTP ${ingestRes.status}`,
        remediation:
          "Set ORCHESTRATOR_INGEST_API_TOKEN to match backend env and ensure backend accepts service token.",
        rerunCommand: "npm run test:fullstack",
      });
    } catch (error) {
      checks.push({
        phase: "Phase 4",
        name: "Orchestrator ingest E2E (service token)",
        mandatory: true,
        status: "FAIL",
        command: "POST /api/ingest/telemetry/packets",
        durationMs: Date.now() - ingestStart,
        detail: error instanceof Error ? error.message : String(error),
        remediation: "Ensure backend is running and ORCHESTRATOR_INGEST_API_TOKEN matches backend config.",
        rerunCommand: "npm run test:fullstack",
      });
    }
  } else {
    checks.push({
      phase: "Phase 4",
      name: "Orchestrator ingest E2E (service token)",
      mandatory: false,
      status: "SKIP",
      detail: "Set ORCHESTRATOR_INGEST_API_TOKEN to validate packet ingest with orchestrator service token.",
    });
  }

  if (config.writeMode.toLowerCase() === "controlled") {
    try {
      const supabase = createSupabaseAdminClient();
      const context = buildControlledWriteContext(runId);
      const result = await controlledWriteValidation(supabase, context);
      checks.push({
        phase: "Phase 4",
        name: "Controlled Supabase write/cleanup validation",
        mandatory: true,
        status: result.ok ? "PASS" : "FAIL",
        detail: `${result.detail}${result.cleanupDetail ? ` | ${result.cleanupDetail}` : ""}`,
        remediation: "Verify Supabase RPC/table grants and rerun with FULLSTACK_WRITE_MODE=controlled.",
      });
    } catch (error) {
      checks.push({
        phase: "Phase 4",
        name: "Controlled Supabase write/cleanup validation",
        mandatory: true,
        status: "FAIL",
        detail: error instanceof Error ? error.message : String(error),
        remediation: "Verify SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and applied migrations.",
      });
    }
  } else {
    checks.push({
      phase: "Phase 4",
      name: "Controlled Supabase write/cleanup validation",
      mandatory: false,
      status: "SKIP",
      detail: `Skipped because FULLSTACK_WRITE_MODE=${config.writeMode}`,
    });
  }

  // Phase 5
  const missionFact = "radiation threshold for LEO in the FDL 2025 paper";
  if (config.ragUrl) {
    try {
      const status = await requestJson(`${config.ragUrl}/api/rag/status`);
      const index = await requestJson(`${config.ragUrl}/api/rag/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `FDL 2025 quick fact: radiation threshold for LEO nominal operations is 42 mSv/day.`,
          metadata: { runId, source: "mission_fullstack" },
        }),
      });
      const query = await requestJson(`${config.ragUrl}/api/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: missionFact, topK: 3 }),
      });
      const queryRaw = typeof query.body === "string" ? query.body : JSON.stringify(query.body);
      const hasCitationSignal = /42|mSv|FDL|2025/i.test(queryRaw);
      checks.push({
        phase: "Phase 5",
        name: "RAG context accuracy check",
        mandatory: false,
        status:
          status.status === 200 && index.status >= 200 && index.status < 300 && query.status === 200 && hasCitationSignal
            ? "PASS"
            : "WARN",
        detail: `status=${status.status}, index=${index.status}, query=${query.status}, citationSignal=${hasCitationSignal}`,
        remediation: "Ensure RAG service is running and returns grounded answers for mission-specific prompts.",
      });
    } catch (error) {
      checks.push({
        phase: "Phase 5",
        name: "RAG context accuracy check",
        mandatory: false,
        status: "WARN",
        detail: error instanceof Error ? error.message : String(error),
        remediation: "Set GAUSS_RAG_URL and ensure /api/rag/* endpoints are reachable.",
      });
    }
  } else {
    checks.push({
      phase: "Phase 5",
      name: "RAG context accuracy check",
      mandatory: false,
      status: "SKIP",
      detail: "Set GAUSS_RAG_URL to enable RAG integration checks.",
    });
  }

  pushCommandCheck(
    "Phase 5",
    "M1 memory pressure snapshot",
    "vm_stat | sed -n '1,20p'",
    false,
    "Close heavy apps before mission run to reduce memory pressure on 8GB systems.",
  );

  // Phase 6
  if (config.runUiE2E) {
    pushCommandCheck("Phase 6", "UI smoke suite", "npm run test:ui", true);
  } else {
    checks.push({
      phase: "Phase 6",
      name: "UI smoke suite",
      mandatory: false,
      status: "SKIP",
      detail: "Skipped by FULLSTACK_SKIP_UI_E2E=true",
    });
  }

  if (config.runUiMobile) {
    pushCommandCheck("Phase 6", "UI mobile layout suite", "npm run test:ui:mobile", true);
  } else {
    checks.push({
      phase: "Phase 6",
      name: "UI mobile layout suite",
      mandatory: false,
      status: "SKIP",
      detail: "Skipped by FULLSTACK_SKIP_UI_MOBILE=true",
    });
  }

  const endedMs = Date.now();
  const endedAt = new Date(endedMs).toISOString();
  const summary = summarizeChecks(checks);
  const status = computeFinalStatus(summary);
  const triage = findTriage(checks);

  const report: MissionReport = {
    runId,
    startedAt,
    endedAt,
    durationMs: endedMs - startedMs,
    status,
    config,
    checks,
    summary,
    triage,
  };

  const stamp = startedAt.replace(/[:.]/g, "-");
  const base = `reports/fullstack/${stamp}`;
  const artifacts = writeReportArtifacts(base, report);

  console.log("Full-Stack Mission Validation");
  console.log("=============================");
  console.log(`Run ID: ${runId}`);
  console.log(`Status: ${status}`);
  console.log(`JSON report: ${artifacts.jsonPath}`);
  console.log(`Markdown summary: ${artifacts.markdownPath}`);
  console.log(
    `Summary: PASS=${summary.pass}, WARN=${summary.warn}, FAIL=${summary.fail}, SKIP=${summary.skip}, mandatory_fail=${summary.mandatoryFailures}`,
  );

  if (triage) {
    console.log("Triage:");
    console.log(`- first issue: ${triage.name}`);
    if (triage.command) console.log(`- command: ${triage.command}`);
    if (triage.detail) console.log(`- detail: ${triage.detail}`);
    if (triage.remediation) console.log(`- remediation: ${triage.remediation}`);
    if (triage.rerunCommand) console.log(`- rerun: ${triage.rerunCommand}`);
  }

  if (status === "FAIL") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Full-stack mission validation failed with unexpected error:", error);
  process.exit(1);
});
