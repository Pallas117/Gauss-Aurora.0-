import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  authenticateRequest,
  authenticateSocket,
  requireRole,
  roleSatisfies,
  type AuthContext,
  type AuthenticatedRequest,
} from "./auth.js";
import { CyberTigerDaemon } from "./cybertiger/daemon.js";
import { inferNowcast, triggerTraining } from "./ml-client/client.js";
import { getSupabaseAdminClient, getSupabaseAnonClient } from "./supabase.js";
import {
  getAuroraMap,
  getCanonicalFeed,
  getLatestCanonical,
  getLatestMms,
  getMmsFeed,
  getSourceStatus,
} from "./state.js";
import type {
  CanonicalSpaceWeatherPoint,
  IngestionTickResult,
  NowcastInferenceRequest,
} from "./types.js";
import { IngestionWorker } from "./worker/ingest-loop.js";

const app = express();
const cyberTiger = new CyberTigerDaemon();

type CyberTigerRequest = AuthenticatedRequest & {
  security?: {
    requestId: string;
    ip: string;
    startedAtMs: number;
    path: string;
    method: string;
  };
};

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=()");
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS blocked"));
    },
  }),
);

function withAsyncMiddleware(
  fn: (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => Promise<void>,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };
}

function parseLookback(value: unknown, fallbackMs: number): number {
  if (typeof value !== "string" || value.length === 0) {
    return fallbackMs;
  }
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value.trim());
  if (!match) {
    return fallbackMs;
  }
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  const total = ((h * 60 + m) * 60 + s) * 1000;
  return total > 0 ? total : fallbackMs;
}

function filterByLookback<T extends { timestamp: string }>(
  points: T[],
  lookbackMs: number,
  limit: number,
): T[] {
  const threshold = Date.now() - lookbackMs;
  const filtered = points.filter((point) => Date.parse(point.timestamp) >= threshold);
  return filtered.slice(Math.max(0, filtered.length - limit));
}

async function fetchCanonicalFromSupabase(
  lookbackMs: number,
  limit: number,
  accessToken?: string,
): Promise<CanonicalSpaceWeatherPoint[] | null> {
  const supabase = accessToken
    ? getSupabaseAnonClient(accessToken)
    : getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }
  const since = new Date(Date.now() - lookbackMs).toISOString();
  const { data, error } = await supabase
    .from("sw_nowcast_5s")
    .select("point,timestamp")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true })
    .limit(limit);

  if (error) {
    return null;
  }
  return (data ?? [])
    .map((row) => row.point as CanonicalSpaceWeatherPoint)
    .filter((point): point is CanonicalSpaceWeatherPoint => Boolean(point));
}

async function fetchMmsFromSupabase(
  lookbackMs: number,
  limit: number,
  accessToken?: string,
): Promise<any[] | null> {
  const supabase = accessToken
    ? getSupabaseAnonClient(accessToken)
    : getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }
  const since = new Date(Date.now() - lookbackMs).toISOString();
  const { data, error } = await supabase
    .from("mms_recon_vectors_5s")
    .select("vector,timestamp")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true })
    .limit(limit);
  if (error) {
    return null;
  }
  return (data ?? []).map((row) => row.vector).filter(Boolean);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const start = Date.now();
  const decision = cyberTiger.inspectRequest(req);
  const tracked = req as CyberTigerRequest;

  tracked.security = {
    requestId: decision.requestId,
    ip: decision.ip,
    startedAtMs: start,
    path: req.originalUrl ?? req.url,
    method: req.method,
  };
  res.setHeader("x-request-id", decision.requestId);

  res.on("finish", () => {
    const detail = tracked.security;
    if (!detail) {
      return;
    }
    cyberTiger.recordResponse({
      requestId: detail.requestId,
      ip: detail.ip,
      method: detail.method,
      path: detail.path,
      status: res.statusCode,
      role: tracked.auth?.role,
      userId: tracked.auth?.userId,
      latencyMs: Date.now() - detail.startedAtMs,
    });
  });

  if (!decision.allowed) {
    res.status(decision.status ?? 429).json({
      error: decision.message ?? "Blocked by CyberTiger",
      requestId: decision.requestId,
    });
    return;
  }

  next();
});
app.use("/api", withAsyncMiddleware(authenticateRequest));

app.get("/api/feed/space-weather/5s", async (req: AuthenticatedRequest, res) => {
  const lookbackMs = parseLookback(req.query.lookback, 24 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 17280), 17280));
  const token = req.auth?.token;

  const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
  const points = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);

  res.json({
    source: fromDb ? "supabase" : "memory",
    count: points.length,
    points,
  });
});

app.get("/api/feed/space-weather/latest", async (req: AuthenticatedRequest, res) => {
  const fromDb = await fetchCanonicalFromSupabase(5 * 60 * 1000, 1, req.auth?.token);
  const point = fromDb && fromDb.length > 0 ? fromDb[fromDb.length - 1] : getLatestCanonical();
  if (!point) {
    res.status(404).json({ error: "No feed data yet" });
    return;
  }
  res.json(point);
});

app.get("/api/feed/mms/reconnection", async (req: AuthenticatedRequest, res) => {
  const lookbackMs = parseLookback(req.query.lookback, 2 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 1440), 5000));
  const token = req.auth?.token;

  const fromDb = await fetchMmsFromSupabase(lookbackMs, limit, token);
  const vectors = fromDb ?? filterByLookback(getMmsFeed(), lookbackMs, limit);

  res.json({
    source: fromDb ? "supabase" : "memory",
    count: vectors.length,
    vectors,
  });
});

app.get("/api/feed/mms/reconnection/latest", async (req: AuthenticatedRequest, res) => {
  const fromDb = await fetchMmsFromSupabase(30 * 60 * 1000, 1, req.auth?.token);
  const vector = fromDb && fromDb.length > 0 ? fromDb[fromDb.length - 1] : getLatestMms();
  if (!vector) {
    res.status(404).json({ error: "No MMS reconnection data yet" });
    return;
  }
  res.json(vector);
});

app.get("/api/feed/aurora/map", async (req: AuthenticatedRequest, res) => {
  const timestamp = typeof req.query.ts === "string" ? req.query.ts : null;
  const projection = typeof req.query.projection === "string" ? req.query.projection : "gsm";

  const map = getAuroraMap();
  if (!map) {
    res.status(404).json({ error: "No aurora map yet" });
    return;
  }

  res.json({
    projection,
    requestedTimestamp: timestamp,
    ...map,
  });
});

app.get("/api/feed/sources/status", (req: AuthenticatedRequest, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    sources: getSourceStatus(),
    auth: {
      userId: req.auth?.userId ?? null,
      role: req.auth?.role ?? null,
    },
  });
});

app.get("/api/security/cybertiger/status", requireRole("operator"), (_req: AuthenticatedRequest, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    status: cyberTiger.getStatus(),
  });
});

app.get("/api/security/cybertiger/events", requireRole("admin"), (req: AuthenticatedRequest, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit ?? 200), 2000));
  res.json({
    timestamp: new Date().toISOString(),
    count: limit,
    events: cyberTiger.getEvents(limit),
  });
});

app.post("/api/security/cybertiger/block", requireRole("admin"), (req: AuthenticatedRequest, res) => {
  const input = req.body as { ip?: string; reason?: string; seconds?: number };
  const ip = (input.ip ?? "").trim();
  if (!ip) {
    res.status(400).json({ error: "Missing ip" });
    return;
  }
  const reason = (input.reason ?? "manual-admin-action").trim();
  const seconds = Number(input.seconds);
  cyberTiger.blockIp(
    ip,
    reason.length > 0 ? reason : "manual-admin-action",
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    {
      actorRole: req.auth?.role,
      actorUserId: req.auth?.userId,
    },
  );
  res.json({ ok: true, ip, reason, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null });
});

app.post("/api/security/cybertiger/unblock", requireRole("admin"), (req: AuthenticatedRequest, res) => {
  const input = req.body as { ip?: string };
  const ip = (input.ip ?? "").trim();
  if (!ip) {
    res.status(400).json({ error: "Missing ip" });
    return;
  }
  const removed = cyberTiger.unblockIp(ip, {
    actorRole: req.auth?.role,
    actorUserId: req.auth?.userId,
  });
  res.json({ ok: removed, ip });
});

app.post("/api/ai/nowcast/infer", requireRole("operator"), async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as Partial<NowcastInferenceRequest>;
    const sequence = Array.isArray(body.sequence) ? body.sequence : [];
    const horizonMinutes = Math.max(5, Math.min(Number(body.horizonMinutes ?? 60), 180));

    if (sequence.length === 0) {
      const current = getLatestCanonical();
      if (!current) {
        res.status(400).json({ error: "No sequence provided and no live feed available" });
        return;
      }
      const fallbackResponse = await inferNowcast({
        horizonMinutes,
        sequence: [current],
      });
      res.json(fallbackResponse);
      return;
    }

    const response = await inferNowcast({
      horizonMinutes,
      sequence,
    });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Inference failed" });
  }
});

app.post("/api/ai/nowcast/train", requireRole("admin"), async (_req, res) => {
  try {
    const result = await triggerTraining();
    if (!result.started) {
      res.status(500).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Training trigger failed" });
  }
});

const port = Number(process.env.PROXY_PORT ?? 3001);
const server = http.createServer(app);

const wsSpaceWeather = new WebSocketServer({ server, path: "/ws/feed/space-weather" });
const wsMmsRecon = new WebSocketServer({ server, path: "/ws/feed/mms-reconnection" });

type AuthedSocket = WebSocket & { auth?: AuthContext };

function broadcast(wss: WebSocketServer, topic: string, payload: unknown): void {
  const body = JSON.stringify({ topic, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    const socket = client as AuthedSocket;
    if (socket.readyState === 1 && socket.auth) {
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
    if (req.socket.remoteAddress) {
      cyberTiger.recordResponse({
        requestId: `ws-${Date.now()}`,
        ip: req.socket.remoteAddress,
        method: "WS",
        path: req.url ?? "/ws",
        status: 403,
      });
    }
    socket.close(1008, "Unauthorized");
    return false;
  }
  socket.auth = auth;
  return true;
}

wsSpaceWeather.on("connection", async (socket: AuthedSocket, req) => {
  const allowed = await guardSocketConnection(socket, "viewer", req);
  if (!allowed) return;

  socket.send(
    JSON.stringify({
      topic: "system",
      payload: {
        stream: "space-weather",
        message: "Connected",
        role: socket.auth?.role ?? "viewer",
        timestamp: new Date().toISOString(),
      },
    }),
  );
});

wsMmsRecon.on("connection", async (socket: AuthedSocket, req) => {
  const allowed = await guardSocketConnection(socket, "viewer", req);
  if (!allowed) return;

  socket.send(
    JSON.stringify({
      topic: "system",
      payload: {
        stream: "mms-reconnection",
        message: "Connected",
        role: socket.auth?.role ?? "viewer",
        timestamp: new Date().toISOString(),
      },
    }),
  );
});

const worker = new IngestionWorker((result: IngestionTickResult) => {
  if (result.canonicalPoint) {
    broadcast(wsSpaceWeather, "space-weather", result.canonicalPoint);
  }
  if (result.mmsVector) {
    broadcast(wsMmsRecon, "mms-reconnection", result.mmsVector);
  }
});
worker.start();

server.listen(port, () => {
  console.log(`[backend] listening on :${port}`);
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[backend] unhandled error", error);
  res.status(500).json({ error: "Internal server error" });
});
