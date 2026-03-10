import assert from "node:assert/strict";
import test from "node:test";
import { executeOpsCommand, type OpsCommandExecutorDeps } from "./ops-command-executor.js";
import type {
  CanonicalSpaceWeatherPoint,
  NowcastInferenceResponse,
  SourceStatus,
} from "./types.js";

function canonicalPoint(): CanonicalSpaceWeatherPoint {
  const ts = "2026-01-01T00:00:00.000Z";
  return {
    timestamp: ts,
    source: "fusion",
    rho: 5,
    velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
    magneticField: { x: 1, y: -2, z: -3, bt: 3.7 },
    electricField: { x: 0, y: 1, z: 0, ey: 1 },
    solarWind: { speed: 450, density: 8, dynamicPressure: 2.4 },
    indices: { kp: 4, dst: -45 },
    coupling: { newell: 1800, epsilon: 2.1e11 },
    propagation: { l1DelaySeconds: 3000, etaEarthArrival: ts },
    alerts: { stormTier: "warning", reason: "test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 420, upper: 480, sigma: 12 },
      density: { lower: 7, upper: 9, sigma: 0.4 },
      bz: { lower: -4, upper: -2, sigma: 0.3 },
    },
  };
}

function sourceStatus(healthy: boolean): SourceStatus[] {
  return [
    {
      source: "noaa-swpc",
      lastSeen: "2026-01-01T00:00:00.000Z",
      latencySeconds: 4,
      healthy,
    },
  ];
}

function makeDeps(input?: Partial<OpsCommandExecutorDeps>): OpsCommandExecutorDeps {
  return {
    inferNowcast: async (req): Promise<NowcastInferenceResponse> => ({
      modelVersion: "test-model",
      generatedAt: "2026-01-01T00:00:00.000Z",
      horizonMinutes: req.horizonMinutes,
      predictions: [],
    }),
    getLatestCanonical: () => canonicalPoint(),
    getSourceStatus: () => sourceStatus(true),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    env: {},
    ...input,
  };
}

test("executeOpsCommand(trigger-nowcast) runs inference using latest canonical data", async () => {
  const result = await executeOpsCommand("trigger-nowcast", { horizonMinutes: 45 }, makeDeps());
  assert.equal(result.executed, true);
  assert.equal(result.commandType, "trigger-nowcast");
  assert.equal(result.mode, "live");
  assert.match(result.detail, /horizon=45/);
});

test("executeOpsCommand(schedule-pass) defers when pass API is disabled", async () => {
  const result = await executeOpsCommand(
    "schedule-pass",
    {},
    makeDeps({
      env: { ORCHESTRATOR_PASS_API_ENABLED: "false" },
    }),
  );
  assert.equal(result.executed, false);
  assert.equal(result.mode, "deferred");
  assert.match(result.detail, /Pass API is disabled/);
});

test("executeOpsCommand(schedule-pass) plans and schedules when pass API succeeds", async () => {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/passes/plan")) {
      return new Response(
        JSON.stringify({
          pass_id: "pass-001",
          status: "planned",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/passes/pass-001/schedule")) {
      return new Response(
        JSON.stringify({
          pass_id: "pass-001",
          status: "scheduled",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  const result = await executeOpsCommand(
    "schedule-pass",
    { target: "DSCOVR", station: "GAUSS-GS-1" },
    makeDeps({
      env: {
        ORCHESTRATOR_PASS_API_ENABLED: "true",
        ORCHESTRATOR_PASS_API_BASE_URL: "http://127.0.0.1:8091",
      },
      fetchFn,
    }),
  );
  assert.equal(result.executed, true);
  assert.equal(result.mode, "live");
  assert.match(result.detail, /planned and scheduled/);
  assert.ok(calls.some((line) => line.endsWith("/passes/plan")));
  assert.ok(calls.some((line) => line.includes("/passes/pass-001/schedule")));
});

test("executeOpsCommand(log-health-check) reports degraded sources", async () => {
  const result = await executeOpsCommand(
    "log-health-check",
    {},
    makeDeps({
      getSourceStatus: () => sourceStatus(false),
    }),
  );
  assert.equal(result.executed, true);
  assert.equal(result.commandType, "log-health-check");
  assert.match(result.detail, /degraded sources/);
});
