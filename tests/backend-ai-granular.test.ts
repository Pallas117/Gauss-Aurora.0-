/**
 * Granular backend and AI test suite: one describe block per area for clear per-endpoint reporting.
 * Run with backend up: npm run test:backend:granular (BACKEND_BASE_URL optional, default 127.0.0.1:3001).
 * With BACKEND_AI_GRANULAR_REPORT_JSON=true writes reports/progress/backend-ai-granular.latest.json.
 * Uses --test-concurrency=1 so the Report step runs last and sees all results.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

const BASE_URL = (process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const REPORT_JSON = process.env.BACKEND_AI_GRANULAR_REPORT_JSON === "true" || process.env.BACKEND_AI_GRANULAR_REPORT_JSON === "1";
const FETCH_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 3500;

/** Set in test.before(); when false, live API tests are skipped (backend not reachable). */
let backendReachable = false;

test.before(async () => {
  try {
    const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    const data = (await r.json()) as { ok?: boolean };
    backendReachable = r.ok === true && data?.ok === true;
  } catch {
    backendReachable = false;
  }
  if (!backendReachable) {
    console.warn(`[backend-ai-granular] Backend not reachable at ${BASE_URL}; skipping live API tests. Start with: npm run dev:proxy`);
  }
});

const viewerToken = (process.env.RBAC_VIEWER_TOKEN ?? "").trim() || null;
const operatorToken = (process.env.RBAC_OPERATOR_TOKEN ?? "").trim() || null;

type ResultEntry = { area: string; name: string; passed: boolean; message?: string };
const results: ResultEntry[] = [];

function record(area: string, name: string, passed: boolean, message?: string): void {
  results.push({ area, name, passed, message });
}

async function fetchOk(
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown } = {},
): Promise<{ status: number; body: unknown; ok: boolean }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, ok: res.ok };
}

test.describe("Health", () => {
  test("GET /health returns 200 and ok", async () => {
    if (!backendReachable) return test.skip();
    const { status, body } = await fetchOk("GET", "/health");
    const ok = status === 200 && typeof (body as { ok?: boolean })?.ok === "boolean";
    record("Health", "GET /health", ok, ok ? "200 ok" : `status=${status}`);
    assert.equal(status, 200);
    assert.equal((body as { ok?: boolean }).ok, true);
  });
});

test.describe("Auth", () => {
  test("GET /api/auth/session returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/auth/session");
    const ok = status === 200 || status === 401 || status === 429;
    record("Auth", "GET /api/auth/session", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });
});

test.describe("Feeds", () => {
  test("GET /api/feed/sources/status returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/feed/sources/status", { token: viewerToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("Feeds", "GET /api/feed/sources/status", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });

  test("GET /api/feed/space-weather/latest returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/feed/space-weather/latest", { token: viewerToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("Feeds", "GET /api/feed/space-weather/latest", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });
});

test.describe("Ops Command", () => {
  test("GET /api/ops/command/latest returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ops/command/latest", { token: operatorToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("Ops Command", "GET /api/ops/command/latest", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });

  test("GET /api/ops/command/log returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ops/command/log", { token: operatorToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("Ops Command", "GET /api/ops/command/log", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });
});

test.describe("Ops Pipeline (triad)", () => {
  test("POST /api/ops/pipeline/triad without body returns 400, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("POST", "/api/ops/pipeline/triad", { token: operatorToken });
    const ok = status === 400 || status === 401 || status === 429;
    record("Ops Pipeline (triad)", "POST /api/ops/pipeline/triad (no body)", ok, `status=${status}`);
    assert.ok(ok, `expected 400, 401, or 429, got ${status}`);
  });

  test("GET /api/ops/pipeline/triad/latest returns 200, 404, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ops/pipeline/triad/latest", { token: operatorToken });
    const ok = status === 200 || status === 404 || status === 401 || status === 429;
    record("Ops Pipeline (triad)", "GET /api/ops/pipeline/triad/latest", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 404, 401, or 429, got ${status}`);
  });
});

test.describe("AI Nowcast", () => {
  test("POST /api/ai/nowcast/infer returns 200, 401, 429, or 502", async () => {
    if (!backendReachable) return test.skip();
    const body = { horizonMinutes: 30, sequence: [] };
    const { status } = await fetchOk("POST", "/api/ai/nowcast/infer", { token: viewerToken ?? operatorToken, body });
    const ok = status === 200 || status === 401 || status === 429 || status === 502;
    record("AI Nowcast", "POST /api/ai/nowcast/infer", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, 429, or 502, got ${status}`);
  });

  test("POST /api/ai/nowcast/train returns 200, 401, 429, or 502", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("POST", "/api/ai/nowcast/train", { token: operatorToken, body: {} });
    const ok = status === 200 || status === 401 || status === 429 || status === 502;
    record("AI Nowcast", "POST /api/ai/nowcast/train", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, 429, or 502, got ${status}`);
  });
});

test.describe("AI Surya", () => {
  test("POST /api/ai/surya/forecast returns 200, 401, 429, 501, or 502", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("POST", "/api/ai/surya/forecast", { token: operatorToken, body: {} });
    const ok = status === 200 || status === 401 || status === 429 || status === 501 || status === 502;
    record("AI Surya", "POST /api/ai/surya/forecast", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, 429, 501, or 502, got ${status}`);
  });

  test("POST /api/ai/surya/flare returns 200, 401, 429, 501, or 502", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("POST", "/api/ai/surya/flare", { token: operatorToken, body: {} });
    const ok = status === 200 || status === 401 || status === 429 || status === 501 || status === 502;
    record("AI Surya", "POST /api/ai/surya/flare", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, 429, 501, or 502, got ${status}`);
  });
});

test.describe("SSA", () => {
  test("GET /api/ssa/risk-zones returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ssa/risk-zones", { token: viewerToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("SSA", "GET /api/ssa/risk-zones", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });

  test("GET /api/ssa/satellites returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ssa/satellites", { token: viewerToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("SSA", "GET /api/ssa/satellites", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });

  test("POST /api/ssa/conjunctions/ingest returns 201, 400, 401, 403, or 429", async () => {
    if (!backendReachable) return test.skip();
    const body = {
      format: "cdm_kvn",
      purpose: "collision_avoidance",
      source: "granular-test",
      content: [
        "CCSDS_CDM_VERS = 1.0",
        "TCA = 2026-03-04T02:00:00Z",
        "MISS_DISTANCE = 125.0",
        "RELATIVE_SPEED = 7600.5",
        "OBJECT1_NAME = TEST-SAT-1",
        "OBJECT2_NAME = TEST-SAT-2",
      ].join("\\n"),
    };
    const { status } = await fetchOk("POST", "/api/ssa/conjunctions/ingest", { token: operatorToken, body });
    const ok = status === 201 || status === 400 || status === 401 || status === 403 || status === 429;
    record("SSA", "POST /api/ssa/conjunctions/ingest", ok, `status=${status}`);
    assert.ok(ok, `expected 201, 400, 401, 403, or 429, got ${status}`);
  });

  test("GET /api/ssa/conjunctions/latest returns 200, 401, 403, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/ssa/conjunctions/latest", { token: operatorToken });
    const ok = status === 200 || status === 401 || status === 403 || status === 429;
    record("SSA", "GET /api/ssa/conjunctions/latest", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, 403, or 429, got ${status}`);
  });
});

test.describe("Turing", () => {
  test("GET /api/turing/devices returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/turing/devices");
    const ok = status === 200 || status === 401 || status === 429;
    record("Turing", "GET /api/turing/devices", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });

  test("GET /api/turing/devices/summary returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/turing/devices/summary");
    const ok = status === 200 || status === 401 || status === 429;
    record("Turing", "GET /api/turing/devices/summary", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });
});

test.describe("Security", () => {
  test("GET /api/security/cybertiger/status returns 200, 401, or 429", async () => {
    if (!backendReachable) return test.skip();
    const { status } = await fetchOk("GET", "/api/security/cybertiger/status", { token: operatorToken });
    const ok = status === 200 || status === 401 || status === 429;
    record("Security", "GET /api/security/cybertiger/status", ok, `status=${status}`);
    assert.ok(ok, `expected 200, 401, or 429, got ${status}`);
  });
});

test.describe("Report", () => {
  test("write backend-ai-granular.latest.json when BACKEND_AI_GRANULAR_REPORT_JSON=true", () => {
    if (!REPORT_JSON) {
      record("Report", "skip write", true, "BACKEND_AI_GRANULAR_REPORT_JSON not set");
      return;
    }
    const byArea: Record<string, { passed: number; failed: number; tests: ResultEntry[] }> = {};
    for (const r of results) {
      if (!byArea[r.area]) byArea[r.area] = { passed: 0, failed: 0, tests: [] };
      byArea[r.area].tests.push(r);
      if (r.passed) byArea[r.area].passed += 1;
      else byArea[r.area].failed += 1;
    }
    const areas = Object.entries(byArea).map(([name, data]) => ({
      name,
      passed: data.passed,
      failed: data.failed,
      tests: data.tests.map((t) => ({ name: t.name, passed: t.passed, message: t.message })),
    }));
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const report = {
      generated_at: new Date().toISOString(),
      base_url: BASE_URL,
      areas,
      summary: { passed, failed, total: results.length },
    };
    const outDir = path.join(process.cwd(), "reports", "progress");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "backend-ai-granular.latest.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    record("Report", "write JSON", true, outPath);
  });
});
