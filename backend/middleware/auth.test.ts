import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../auth.js";
import { authenticateRequestOptional, requireRole } from "./auth.js";

function createRequest(headers: Record<string, string> = {}): AuthenticatedRequest {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    header(name: string) {
      return normalized.get(name.toLowerCase());
    },
    query: {},
  } as AuthenticatedRequest;
}

function createResponse(): Response & { statusCodeValue: number | null; jsonBody: unknown } {
  const state = {
    statusCodeValue: null as number | null,
    jsonBody: null as unknown,
  };

  return {
    status(code: number) {
      state.statusCodeValue = code;
      return this;
    },
    json(body: unknown) {
      state.jsonBody = body;
      return this;
    },
    get statusCodeValue() {
      return state.statusCodeValue;
    },
    get jsonBody() {
      return state.jsonBody;
    },
  } as Response & { statusCodeValue: number | null; jsonBody: unknown };
}

test("authenticateRequestOptional allows anonymous requests without forcing a 401", async () => {
  const previous = {
    AUTH_REQUIRED: process.env.AUTH_REQUIRED,
    ORCHESTRATOR_INGEST_API_TOKEN: process.env.ORCHESTRATOR_INGEST_API_TOKEN,
  };
  process.env.AUTH_REQUIRED = "true";
  delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;

  try {
    const req = createRequest();
    const res = createResponse();
    let nextCalled = false;

    await authenticateRequestOptional(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, true);
    assert.equal(req.auth, undefined);
    assert.equal(res.statusCodeValue, null);
    assert.equal(res.jsonBody, null);
  } finally {
    if (previous.AUTH_REQUIRED === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous.AUTH_REQUIRED;
    if (previous.ORCHESTRATOR_INGEST_API_TOKEN === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previous.ORCHESTRATOR_INGEST_API_TOKEN;
  }
});

test("requireRole hydrates auth context from the orchestrator service token", async () => {
  const previous = {
    AUTH_REQUIRED: process.env.AUTH_REQUIRED,
    ORCHESTRATOR_INGEST_API_TOKEN: process.env.ORCHESTRATOR_INGEST_API_TOKEN,
  };
  process.env.AUTH_REQUIRED = "true";
  process.env.ORCHESTRATOR_INGEST_API_TOKEN = "svc-token";

  try {
    const req = createRequest({ "x-gauss-service-token": "svc-token" });
    const res = createResponse();
    let nextCalled = false;

    await requireRole("operator")(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, true);
    assert.equal(req.auth?.userId, "orchestrator-service");
    assert.equal(req.auth?.role, "admin");
    assert.equal(req.auth?.clearance, "restricted");
    assert.equal(res.statusCodeValue, null);
  } finally {
    if (previous.AUTH_REQUIRED === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous.AUTH_REQUIRED;
    if (previous.ORCHESTRATOR_INGEST_API_TOKEN === undefined) delete process.env.ORCHESTRATOR_INGEST_API_TOKEN;
    else process.env.ORCHESTRATOR_INGEST_API_TOKEN = previous.ORCHESTRATOR_INGEST_API_TOKEN;
  }
});
