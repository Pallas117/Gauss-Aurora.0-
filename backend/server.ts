import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { CyberTigerDaemon } from "./cybertiger/daemon.js";
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
  triggerTraining,
} from "./ml-client/client.js";
import {
  getLatestCanonical,
  getRiskZones,
  getSatelliteObjects,
  getSourceStatus,
} from "./state.js";
import { getRuntimeMemoryPressureSnapshot } from "./runtime/memory-pressure.js";
import {
  parseLookback,
  parseEnvBool,
  parseEnvInt,
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
import { mountSecurityRoutes } from "./routes/security.js";
import { mountIngestRoutes } from "./routes/ingest.js";
import { mountFeedRoutes } from "./routes/feed.js";
import { mountSsaRoutes } from "./routes/ssa.js";
import { mountBillingRoutes } from "./routes/billing.js";
import { mountOpsControlRoutes } from "./routes/ops-control.js";

const app = express();
const cyberTiger = new CyberTigerDaemon();
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
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    memory: getRuntimeMemoryPressureSnapshot(),
  });
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
mountSecurityRoutes(app, { cyberTiger });
mountIngestRoutes(app);
mountFeedRoutes(app);
mountSsaRoutes(app);
mountBillingRoutes(app);

// --- 4. Ingestion Runtime Factory & Control Routes ---
const server = http.createServer(app);

const wsSpaceWeather = new WebSocketServer({
  server,
  path: "/ws/feed/space-weather",
  perMessageDeflate: false,
});
const wsMmsRecon = new WebSocketServer({
  server,
  path: "/ws/feed/mms-reconnection",
  perMessageDeflate: false,
});

type AuthedSocket = WebSocket & { auth?: AuthContext };

function broadcast(wss: WebSocketServer, topic: string, payload: unknown): void {
  const body = JSON.stringify({ topic, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    const socket = client as AuthedSocket;
    if (socket.readyState === WebSocket.OPEN && socket.auth) {
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
const port = Number(process.env.PROXY_PORT ?? 3001);
const defaultProxyHost = allowPrivateNetworkOrigins ? "0.0.0.0" : "127.0.0.1";
const host = (process.env.PROXY_HOST ?? defaultProxyHost).trim() || defaultProxyHost;

function shutdown() {
  console.log("[server] shutting down...");
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
  void recoverPersistedOpsJobs();
  void checkLocalChatEngine().then(res => console.log(`[startup] Chat engine: ${res.message}`));
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});
