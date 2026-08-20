import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, appendFileSync } from "node:fs";
import os from "node:os";
import path, { join } from "node:path";
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  type AuthContext,
  type AuthenticatedRequest,
  roleSatisfies,
} from "./auth.js";
import {
  authenticateSocket,
  requireRole,
  requireClearance,
} from "./middleware/auth.js";
import { withAsyncMiddleware } from "./middleware/async.js";
import {
  securityHeaders,
  createCyberTigerMiddleware,
} from "./middleware/security.js";
import { getCyberTiger } from "./cybertiger/daemon.js";
import { getSlackConnector } from "./cybertiger/slack-connector.js";
import {
  claimOpsCommandJob,
  finalizeOpsCommandJob,
  getCommandLogPool,
  getOpsCommandJob,
  listOpsCommandJobs,
  reclaimStaleRunningOpsCommandJobs,
  upsertOpsCommandJob,
} from "./pg.js";
import {
  hydratePersistedSourceHealthState,
  buildThreatSummaryPayload,
  loadDtnIslStatus,
  getLastTriadReport,
} from "./mission-logic.js";
import { hydratePersistedConjunctionState } from "./ssa/conjunction-store.js";
import {
  inferNowcast,
} from "./ml-client/client.js";
import {
  getLatestCanonical,
  getRiskZones,
  getSatelliteObjects,
  getSourceStatus,
} from "./state.js";
import {
  toMemoryGovernorHealth,
} from "./runtime/memory-pressure.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "./runtime/limit-context-recorder.js";
import {
  parseLookback,
  parseEnvBool,
  parseEnvInt,
  detectTailscaleIp,
} from "./utils.js";
import { IngestionWorker } from "./worker/ingest-loop.js";
import {
  IngestionRuntimeController,
  resolveIngestionRuntimeMode,
} from "./worker/runtime-controller.js";
import { checkLocalChatEngine } from "./scripts/local-chat-engine-check.js";
import { executeOpsCommand } from "./ops-command-executor.js";
import {
  OpsCommandRuntime,
  type OpsCommandJobInput,
  type OpsCommandJobRecord,
} from "./ops-command-runtime.js";
import type { IngestionTickResult } from "./types.js";

// Route module imports
import { mountAuthRoutes } from "./routes/auth.js";
import { mountOnboardingRoutes } from "./routes/onboarding.js";
import { mountFeedbackRoutes, type FeedbackEvent } from "./routes/feedback.js";
import { mountOperatorSourcesRoutes } from "./routes/operator-sources.js";
import { mountConjunctionInteropRoutes } from "./routes/conjunction-interop.js";
import { mountMissionRoutes } from "./routes/mission.js";
import { mountAiRoutes } from "./routes/ai.js";
import { mountTuringRoutes } from "./routes/turing.js";
import { mountRadiationWorkRoutes } from "./routes/radiation-work.js";
import { mountProcessingRoutes } from "./routes/processing.js";
import { mountMeshRoutes } from "./routes/mesh.js";
import { mountNetworkRoutes } from "./routes/network.js";
import { assertMeshPolicy } from "./mesh/config.js";
import { getTuringAutoscaler } from "./turing/autoscaler.js";
import { mountSecurityRoutes } from "./routes/security.js";
import { mountIngestRoutes } from "./routes/ingest.js";
import { mountFeedRoutes } from "./routes/feed.js";
import { mountSsaRoutes } from "./routes/ssa.js";
import { mountBillingRoutes } from "./routes/billing.js";
import { mountOpsControlRoutes } from "./routes/ops-control.js";
import {
  assertDataResidencyPolicy,
  assertProductionSecurityProfile,
} from "./security/data-residency.js";
import {
  startRadiationWorkScheduler,
  stopRadiationWorkScheduler,
} from "./turing/radiation-work.js";

const app = express();
const cyberTiger = getCyberTiger();
const feedbackEvents: FeedbackEvent[] = [];

let opsCommandRuntime: OpsCommandRuntime;
let ingestionRuntime: IngestionRuntimeController;
const opsWorkerId = `ops-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const opsPersistenceEnabled = parseEnvBool("ORCHESTRATOR_OPS_PERSIST_ENABLED", true);
const opsIdempotencyTtlMs = Math.max(
  10_000,
  parseEnvInt("ORCHESTRATOR_OPS_IDEMPOTENCY_TTL_MS", 10 * 60 * 1000),
);
const opsReclaimRunningAfterMs = Math.max(
  30_000,
  parseEnvInt("ORCHESTRATOR_OPS_RECLAIM_RUNNING_AFTER_MS", 2 * 60 * 1000),
);

// --- 1. Ops Command Runtime Initialization ---
opsCommandRuntime = new OpsCommandRuntime(async (job: OpsCommandJobRecord) => {
  if (opsPersistenceEnabled) {
    const claimed = await claimOpsCommandJob(job.jobId, opsWorkerId);
    if (!claimed) {
      const persisted = await getOpsCommandJob(job.jobId);
      if (persisted) {
        opsCommandRuntime.adoptPersistedJob(persisted);
      }
      return {
        executed: true,
        commandType: job.commandType,
        mode: "deferred",
        detail: "Job claimed by another worker; skipped local execution.",
        output: persisted ?? null,
      };
    }
  }

  try {
    const result = await executeOpsCommand(
      job.commandType,
      job.payload,
      {
        inferNowcast,
        getLatestCanonical,
        getSourceStatus,
      },
      {
        simulate: job.simulate,
        idempotencyKey: job.idempotencyKey,
      },
    );

    if (opsPersistenceEnabled) {
      await finalizeOpsCommandJob({
        jobId: job.jobId,
        status: result.executed ? "succeeded" : "failed",
        result: {
          executed: result.executed,
          commandType: result.commandType,
          mode: result.mode,
          detail: result.detail,
          output: result.output ?? null,
        },
        error: result.executed ? null : result.detail,
      });
    }
    return result;
  } catch (error) {
    if (opsPersistenceEnabled) {
      await finalizeOpsCommandJob({
        jobId: job.jobId,
        status: "failed",
        result: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}, {
  idempotencyTtlMs: opsIdempotencyTtlMs,
});

async function enqueueOpsCommandWithPersistence(input: OpsCommandJobInput) {
  if (opsPersistenceEnabled && getCommandLogPool()) {
    const persisted = await upsertOpsCommandJob(
      {
        jobId: randomUUID(),
        commandType: input.commandType,
        payload: input.payload,
        source: input.source,
        simulate: input.simulate,
        idempotencyKey: input.idempotencyKey ?? null,
        requestedBy: input.requestedBy ?? null,
        powerConstrained: Boolean(input.powerConstrained),
        heavyCommand: Boolean(input.heavyCommand),
      },
      opsIdempotencyTtlMs,
    );
    if (persisted) {
      opsCommandRuntime.adoptPersistedJob(persisted.job);
      return persisted;
    }
  }
  return opsCommandRuntime.enqueue(input);
}

async function recoverPersistedOpsJobs(): Promise<void> {
  if (!opsPersistenceEnabled || !getCommandLogPool()) return;
  const reclaimed = await reclaimStaleRunningOpsCommandJobs(opsReclaimRunningAfterMs);
  if (reclaimed > 0) {
    console.warn(`[ops-command] reclaimed ${reclaimed} stale running job(s) after restart`);
  }
  const planned = await listOpsCommandJobs(250, ["planned"]);
  for (const job of planned) {
    opsCommandRuntime.adoptPersistedJob(job);
  }
  if (planned.length > 0) {
    console.log(`[ops-command] recovered ${planned.length} planned job(s) from persistence`);
  }
}

// --- 2. Middleware & Global Settings ---
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const allowPrivateNetworkOrigins = parseEnvBool("ALLOW_PRIVATE_NETWORK_ORIGINS", false);
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale VPN range (100.64.0.0/10)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (configuredOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    try {
      const parsed = new URL(origin);
      if (loopbackHosts.has(parsed.hostname)) {
        callback(null, true);
        return;
      }
      if (allowPrivateNetworkOrigins && isPrivateNetworkHost(parsed.hostname)) {
        callback(null, true);
        return;
      }
    } catch {
      // Ignored
    }
    callback(new Error("CORS blocked"));
  },
  credentials: true
}));

app.use(securityHeaders);

const cyberTigerMiddleware = createCyberTigerMiddleware(cyberTiger);

app.get("/health", (_req, res) => {
  try {
    const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("health", {
      route: "/health",
    });
    const cpus = os.cpus();
    const load = os.loadavg();
    const cpuUsage = cpus.length > 0 ? Math.round((load[0] / cpus.length) * 100) : 0;

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      memory: {
        ...toMemoryGovernorHealth(memorySnapshot),
        totalGb: memorySnapshot.totalRamGb,
        usedGb: memorySnapshot.usedRamGb,
        freeGb: memorySnapshot.freeRamGb,
      },
      cpu: {
        usage: cpuUsage,
      }
    });
  } catch (err) {
    console.error("[health] Error generating health report:", err);
    res.status(500).json({ ok: false, error: "Health probe failed" });
  }
});
app.use("/openmct", express.static(join(process.cwd(), "openmct")));
app.use("/api", cyberTigerMiddleware);

// --- 3. Route Mounting ---
mountAuthRoutes(app);
mountOnboardingRoutes(app);
mountFeedbackRoutes(app, { requireRole, feedbackEvents });
mountOperatorSourcesRoutes(app, { requireRole, withAsyncMiddleware });
mountConjunctionInteropRoutes(app, { requireRole, requireClearance, withAsyncMiddleware });
mountMissionRoutes(app, { cyberTiger });
mountAiRoutes(app);
mountTuringRoutes(app);
mountRadiationWorkRoutes(app);
mountProcessingRoutes(app);
mountMeshRoutes(app);
mountNetworkRoutes(app);
mountSecurityRoutes(app, { cyberTiger });
mountIngestRoutes(app);
mountFeedRoutes(app);
mountSsaRoutes(app);
mountBillingRoutes(app);

// --- 4. Ingestion Runtime Factory & Control Routes ---
const server = http.createServer(app);
const turingAutoscaler = getTuringAutoscaler();
const MAX_WS_PAYLOAD_BYTES = 256 * 1024;
const MAX_WS_BUFFERED_BYTES = 512 * 1024;

const wsSpaceWeather = new WebSocketServer({
  server,
  path: "/ws/feed/space-weather",
  perMessageDeflate: false,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});
const wsMmsRecon = new WebSocketServer({
  server,
  path: "/ws/feed/mms-reconnection",
  perMessageDeflate: false,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

type AuthedSocket = WebSocket & { auth?: AuthContext };

function broadcast(wss: WebSocketServer, topic: string, payload: unknown): void {
  const body = JSON.stringify({ topic, payload, timestamp: new Date().toISOString() });
  if (Buffer.byteLength(body, "utf8") > MAX_WS_PAYLOAD_BYTES) return;
  for (const client of wss.clients) {
    const socket = client as AuthedSocket;
    if (socket.readyState === WebSocket.OPEN && socket.auth) {
      // Drop slow consumers before ws retains an unbounded outbound queue.
      if (socket.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        socket.terminate();
        continue;
      }
      client.send(body);
    }
  }
}

async function guardSocketConnection(
  socket: AuthedSocket,
  requiredRole: "viewer" | "operator" | "admin",
  req: http.IncomingMessage,
): Promise<boolean> {
  const auth = await authenticateSocket(req);
  if (!auth || !roleSatisfies(auth.role, requiredRole)) {
    socket.close(1008, "Unauthorized");
    return false;
  }
  socket.auth = auth;
  return true;
}

wsSpaceWeather.on("connection", async (socket: AuthedSocket, req) => {
  const allowed = await guardSocketConnection(socket, "viewer", req);
  if (!allowed) return;
  socket.send(JSON.stringify({ topic: "system", payload: { message: "Connected to Space Weather", timestamp: new Date().toISOString() } }));
});

wsMmsRecon.on("connection", async (socket: AuthedSocket, req) => {
  const allowed = await guardSocketConnection(socket, "viewer", req);
  if (!allowed) return;
  socket.send(JSON.stringify({ topic: "system", payload: { message: "Connected to MMS Reconnection", timestamp: new Date().toISOString() } }));
});

ingestionRuntime = new IngestionRuntimeController({
  initialMode: resolveIngestionRuntimeMode(process.env.GAUSS_RUNTIME_MODE ?? process.env.GAUSS_INGEST_MODE),
  createWorker: () => new IngestionWorker(async (tick: IngestionTickResult) => {
    if (tick.canonicalPoint) broadcast(wsSpaceWeather, "space-weather", tick.canonicalPoint);
    if (tick.mmsVector) broadcast(wsMmsRecon, "mms-reconnection", tick.mmsVector);
    return { ok: true };
  }),
});

mountOpsControlRoutes(app, {
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
  getLastTriadReport: () => getLastTriadReport(),
});

const serveFrontendDist = parseEnvBool("SERVE_FRONTEND_DIST", false);
const distRoot = join(process.cwd(), "dist");
const distIndex = join(distRoot, "index.html");
const distAvailable = existsSync(distIndex);

if (serveFrontendDist) {
  if (distAvailable) {
    app.use(express.static(distRoot, { index: false }));
    app.get(/^\/(?!api(?:\/|$)|health(?:\/|$)|openmct(?:\/|$)|ws(?:\/|$)).*/, (_req, res) => {
      res.sendFile(distIndex);
    });
  } else {
    console.warn("[server] SERVE_FRONTEND_DIST=true but dist/index.html is missing. Run `npm run build` first.");
  }
}

// --- 5. Lifecycle & Startup ---
// Validate before binding a socket. The network-only profile is deliberately
// fail-closed so a misconfigured Kali deployment cannot process sensitive data
// locally or silently fall back to a local model.
assertDataResidencyPolicy();
assertProductionSecurityProfile();
assertMeshPolicy();

const port = Number(process.env.PROXY_PORT ?? 3001);
const defaultProxyHost = allowPrivateNetworkOrigins ? "0.0.0.0" : "127.0.0.1";
const PORT = process.env.PORT || 3001;
let host = (process.env.PROXY_HOST ?? defaultProxyHost).trim() || defaultProxyHost;

if (host.toLowerCase() === "tailscale") {
  const tsIp = detectTailscaleIp();
  if (tsIp) {
    console.log(`[server] Hosting on Tailscale IP: ${tsIp}`);
    host = tsIp;
  } else {
    console.warn(`[server] PROXY_HOST=tailscale requested, but Tailscale IP was not detected. Falling back to default: ${defaultProxyHost}`);
    host = defaultProxyHost;
  }
}

function shutdown() {
  console.log("[server] shutting down...");
  turingAutoscaler.stop();
  stopRadiationWorkScheduler();
  ingestionRuntime.stop("shutdown");
  wsSpaceWeather.close();
  wsMmsRecon.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(port, host, () => {
  console.log(`[server] Gauss Aurora running at http://${host}:${port}`);
  void hydratePersistedConjunctionState()
    .catch(() => [])
    .finally(() => hydratePersistedSourceHealthState().finally(() => ingestionRuntime.start()));
  turingAutoscaler.start();
  startRadiationWorkScheduler();
  void recoverPersistedOpsJobs();
  const startupMemory = getTrackedRuntimeMemoryPressureSnapshot("startup", {
    route: "server.listen",
  });
  console.log(`[startup] Runtime status: ${startupMemory.level}`);
});

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] Unhandled error:", err);
  const logMsg = `[${new Date().toISOString()}] ${err?.message}\n${err?.stack}\n\n`;
  try {
    appendFileSync("/tmp/gauss-errors.log", logMsg);
  } catch (e) {
    console.error("Failed to write to log file:", e);
  }

  // Optional Slack notification for unhandled errors
  const slack = getSlackConnector();
  const errorMsg = `🚨 *Server Unhandled Error*\n` +
    `Message: ${err?.message || "Unknown error"}\n` +
    `Path: \`${req.path}\`\n` +
    `Method: \`${req.method}\`\n` +
    `Timestamp: ${new Date().toISOString()}`;
  
  void slack.notify(errorMsg).catch(e => console.error("[server] Slack notify error:", e));

  res.status(500).json({ error: "Internal server error" });
});
