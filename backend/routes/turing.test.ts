import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { mountTuringRoutes } from "./turing.js";
import { removeDevice } from "../turing/pool.js";

async function listen(server: http.Server, host = "127.0.0.1"): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

async function requestJson(
  port: number,
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<{ statusCode: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload).toString(),
              }
            : {}),
          ...(headers ?? {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          let parsed: unknown = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            payload: parsed,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  mountTuringRoutes(app);
  return app;
}

test("turing register and heartbeat enforce TURING_REGISTER_SECRET when configured", async () => {
  const previousSecret = process.env.TURING_REGISTER_SECRET;
  process.env.TURING_REGISTER_SECRET = "mesh-secret";

  const app = createApp();
  const server = http.createServer(app);
  const port = await listen(server);
  let deviceId: string | null = null;

  try {
    const denied = await requestJson(port, "POST", "/api/turing/register", undefined, {
      hostname: "judith",
      tailscale_ip: "100.99.0.1",
    });
    assert.equal(denied.statusCode, 403);

    const registered = await requestJson(
      port,
      "POST",
      "/api/turing/register",
      { "x-turing-secret": "mesh-secret" },
      {
        hostname: "judith",
        tailscale_ip: "100.99.0.1",
        capabilities: ["cache"],
      },
    );
    assert.equal(registered.statusCode, 201);
    deviceId = (registered.payload as { id: string }).id;
    assert.ok(deviceId);

    const heartbeatDenied = await requestJson(port, "POST", "/api/turing/heartbeat", undefined, {
      device_id: deviceId,
    });
    assert.equal(heartbeatDenied.statusCode, 403);

    const heartbeatOk = await requestJson(
      port,
      "POST",
      "/api/turing/heartbeat",
      { "x-turing-secret": "mesh-secret" },
      {
        device_id: deviceId,
        ram_used_mb: 256,
        load: 0.4,
      },
    );
    assert.equal(heartbeatOk.statusCode, 200);
    assert.deepEqual(heartbeatOk.payload, { id: deviceId, ok: true });
  } finally {
    server.close();
    if (deviceId) {
      removeDevice(deviceId);
    }
    if (previousSecret === undefined) delete process.env.TURING_REGISTER_SECRET;
    else process.env.TURING_REGISTER_SECRET = previousSecret;
  }
});

test("turing join code auto-approves device registration", async () => {
  const previousSecret = process.env.TURING_REGISTER_SECRET;
  const previousServiceToken = process.env.ORCHESTRATOR_INGEST_API_TOKEN;
  delete process.env.TURING_REGISTER_SECRET;
  process.env.ORCHESTRATOR_INGEST_API_TOKEN = "svc-token";

  const app = createApp();
  const server = http.createServer(app);
  const port = await listen(server);
  let deviceId: string | null = null;

  try {
    const joinCodeResponse = await requestJson(
      port,
      "POST",
      "/api/turing/join-code",
      { "x-gauss-service-token": "svc-token" },
    );
    assert.equal(joinCodeResponse.statusCode, 200);
    const joinCode = (joinCodeResponse.payload as { code: string }).code;
    assert.ok(joinCode);

    const registerResponse = await requestJson(port, "POST", "/api/turing/register", undefined, {
      hostname: "pallas0",
      tailscale_ip: "100.99.0.2",
      join_code: joinCode,
    });
    assert.equal(registerResponse.statusCode, 201);
    deviceId = (registerResponse.payload as { id: string }).id;
    assert.equal((registerResponse.payload as { approved: boolean }).approved, true);
  } finally {
    server.close();
    if (deviceId) {
      removeDevice(deviceId);
    }
    if (previousServiceToken === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previousServiceToken;
    if (previousSecret === undefined) delete process.env.TURING_REGISTER_SECRET;
    else process.env.TURING_REGISTER_SECRET = previousSecret;
  }
});

test("turing operator routes proxy device health and heal", async () => {
  const previousServiceToken = process.env.ORCHESTRATOR_INGEST_API_TOKEN;
  const previousDevicePort = process.env.TURING_DEVICE_PORT;
  process.env.ORCHESTRATOR_INGEST_API_TOKEN = "svc-token";

  const deviceApp = express();
  deviceApp.get("/health", (_req, res) => {
    res.json({ ok: true, ram_used_mb: 128, load: 0.2 });
  });
  deviceApp.post("/heal", (_req, res) => {
    res.json({ ok: true, message: "heal completed", expired_cleared: 3 });
  });
  const deviceServer = http.createServer(deviceApp);
  const devicePort = await listen(deviceServer);
  process.env.TURING_DEVICE_PORT = String(devicePort);

  const app = createApp();
  const server = http.createServer(app);
  const port = await listen(server);
  let deviceId: string | null = null;

  try {
    const registerResponse = await requestJson(port, "POST", "/api/turing/register", undefined, {
      hostname: "local-cache",
      tailscale_ip: "127.0.0.1",
      capabilities: ["cache", "inference"],
    });
    assert.equal(registerResponse.statusCode, 201);
    deviceId = (registerResponse.payload as { id: string }).id;
    assert.ok(deviceId);

    const approveResponse = await requestJson(
      port,
      "POST",
      `/api/turing/devices/${encodeURIComponent(deviceId)}/approve`,
      { "x-gauss-service-token": "svc-token" },
    );
    assert.equal(approveResponse.statusCode, 200);

    const healthResponse = await requestJson(
      port,
      "GET",
      `/api/turing/devices/${encodeURIComponent(deviceId)}/health`,
      { "x-gauss-service-token": "svc-token" },
    );
    assert.equal(healthResponse.statusCode, 200);
    assert.deepEqual(healthResponse.payload, {
      device_id: deviceId,
      ok: true,
      ram_used_mb: 128,
      load: 0.2,
    });

    const healResponse = await requestJson(
      port,
      "POST",
      `/api/turing/devices/${encodeURIComponent(deviceId)}/heal`,
      { "x-gauss-service-token": "svc-token" },
    );
    assert.equal(healResponse.statusCode, 200);
    assert.deepEqual(healResponse.payload, {
      device_id: deviceId,
      ok: true,
      message: "heal completed",
      expired_cleared: 3,
    });
  } finally {
    server.close();
    deviceServer.close();
    if (deviceId) {
      removeDevice(deviceId);
    }
    if (previousServiceToken === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previousServiceToken;
    if (previousDevicePort === undefined) delete process.env.TURING_DEVICE_PORT;
    else process.env.TURING_DEVICE_PORT = previousDevicePort;
  }
});
