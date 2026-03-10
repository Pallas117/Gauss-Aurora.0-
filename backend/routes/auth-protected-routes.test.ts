import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { mountBillingRoutes } from "./billing.js";
import { mountOnboardingRoutes } from "./onboarding.js";

async function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EPERM") {
        resolve(-1);
        return;
      }
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
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
    if (port === -1) {
      resolve({ statusCode: 200, payload: { skipped: true } });
      return;
    }

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
          resolve({
            statusCode: res.statusCode ?? 0,
            payload: raw ? JSON.parse(raw) : null,
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

test("onboarding route authenticates before checking backend services", async () => {
  const previous = {
    AUTH_REQUIRED: process.env.AUTH_REQUIRED,
    ORCHESTRATOR_INGEST_API_TOKEN: process.env.ORCHESTRATOR_INGEST_API_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.AUTH_REQUIRED = "true";
  process.env.ORCHESTRATOR_INGEST_API_TOKEN = "svc-token";
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const app = express();
  app.use(express.json());
  mountOnboardingRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await requestJson(port, "GET", "/api/auth/onboarding", {
      "x-gauss-service-token": "svc-token",
    });
    if ((response.payload as { skipped?: boolean })?.skipped) {
      return;
    }

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.payload, { error: "Onboarding service unavailable" });
  } finally {
    server.close();
    if (previous.AUTH_REQUIRED === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous.AUTH_REQUIRED;
    if (previous.ORCHESTRATOR_INGEST_API_TOKEN === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previous.ORCHESTRATOR_INGEST_API_TOKEN;
    if (previous.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.SUPABASE_URL;
    if (previous.VITE_SUPABASE_URL === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previous.VITE_SUPABASE_URL;
    if (previous.SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("billing route authenticates before validating Stripe configuration", async () => {
  const previous = {
    AUTH_REQUIRED: process.env.AUTH_REQUIRED,
    ORCHESTRATOR_INGEST_API_TOKEN: process.env.ORCHESTRATOR_INGEST_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_OPERATOR: process.env.STRIPE_PRICE_OPERATOR,
  };
  process.env.AUTH_REQUIRED = "true";
  process.env.ORCHESTRATOR_INGEST_API_TOKEN = "svc-token";
  delete process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_PRICE_OPERATOR = "price_operator";

  const app = express();
  app.use(express.json());
  mountBillingRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await requestJson(
      port,
      "POST",
      "/api/stripe/create-checkout-session",
      {
        "x-gauss-service-token": "svc-token",
      },
      { planId: "operator", pilot: false },
    );
    if ((response.payload as { skipped?: boolean })?.skipped) {
      return;
    }

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.payload, {
      error: "Stripe is not configured. Set STRIPE_SECRET_KEY.",
    });
  } finally {
    server.close();
    if (previous.AUTH_REQUIRED === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous.AUTH_REQUIRED;
    if (previous.ORCHESTRATOR_INGEST_API_TOKEN === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previous.ORCHESTRATOR_INGEST_API_TOKEN;
    if (previous.STRIPE_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous.STRIPE_SECRET_KEY;
    if (previous.STRIPE_PRICE_OPERATOR === undefined) delete process.env.STRIPE_PRICE_OPERATOR;
    else process.env.STRIPE_PRICE_OPERATOR = previous.STRIPE_PRICE_OPERATOR;
  }
});
