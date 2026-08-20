import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { mountOpsControlRoutes } from "./ops-control.js";
import { pushCanonical, setSourceStatus } from "../state.js";

test("ops control routes expose runtime status and offline repair fallback artifact", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "gauss-ops-control-"));
  const capsulePath = join(tmpRoot, "offline-repair-capsule.latest.json");
  const artifactsDir = join(tmpRoot, "repair-patches");
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    capsulePath,
    `${JSON.stringify(
      {
        generated_at: "2026-03-07T00:00:00.000Z",
        root: process.cwd(),
        profile: {
          strict_local_inference: true,
          local_engine_url: null,
        },
        system_flow: [],
        prompt_contract: {
          role: "Offline planner",
          instructions: [],
          required_output: [],
          validator_policy: [],
        },
        repair_batches: [
          {
            batchId: "offline-batch-1",
            goal: "Reduce backend coupling before autonomous patch execution.",
            rationale: "Bound server split scope.",
            maxFilesChanged: 3,
            maxChangedLines: 180,
            allowedActions: ["read-local-files"],
            blockedActions: ["network-access"],
            validatorSequence: ["npm run -s lint"],
            items: [
              {
                id: "hotspot-1",
                severity: "P1",
                category: "architecture",
                title: "backend/server.ts is still oversized",
                target: "backend/server.ts",
                evidence: "server hotspot",
                recommendation: "extract routes",
                offlineFixable: true,
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const previousEnv = {
    ORCHESTRATOR_LOCAL_ENGINE_URL: process.env.ORCHESTRATOR_LOCAL_ENGINE_URL,
    GAUSS_BRAIN_URL: process.env.GAUSS_BRAIN_URL,
    MLX_CHAT_URL: process.env.MLX_CHAT_URL,
    MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB: process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB,
    MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB: process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB,
  };
  delete process.env.ORCHESTRATOR_LOCAL_ENGINE_URL;
  delete process.env.GAUSS_BRAIN_URL;
  delete process.env.MLX_CHAT_URL;
  process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = "0";
  process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = "0";
  pushCanonical({
    timestamp: "2026-03-07T00:00:00.000Z",
    source: "fusion",
    rho: 7,
    velocity: { x: -420, y: 18, z: -9, magnitude: 445 },
    magneticField: { x: 2, y: -1, z: -5.5, bt: 6.2 },
    electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
    solarWind: { speed: 445, density: 7, dynamicPressure: 2.8 },
    indices: { kp: 4, dst: -48 },
    coupling: { newell: 12000, epsilon: 810000 },
    propagation: { l1DelaySeconds: 1600, etaEarthArrival: "2026-03-07T00:26:40.000Z" },
    alerts: { stormTier: "warning", reason: "test" },
    quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
    uncertainty: {
      speed: { lower: 430, upper: 460, sigma: 8 },
      density: { lower: 6.5, upper: 7.5, sigma: 0.3 },
      bz: { lower: -6, upper: -4, sigma: 0.5 },
    },
  });
  setSourceStatus([
    {
      source: "noaa-swpc",
      lastSeen: "2026-03-07T00:00:00.000Z",
      latencySeconds: 5,
      healthy: true,
    },
  ]);

  const app = express();
  app.use(express.json());
  const requireRole = () => (_req: unknown, _res: unknown, next: () => void) => next();
  const requireClearance = () => (_req: unknown, _res: unknown, next: () => void) => next();
  const withAsyncMiddleware = (
    fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>,
  ) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  };

  let runtimeMode: "active" | "suspended" | "offloaded" = "suspended";
  mountOpsControlRoutes(app, {
    requireRole,
    requireClearance,
    withAsyncMiddleware,
    opsCommandRuntime: {
      notePlanner: () => {},
      getJob: () => null,
      listJobs: () => [],
      snapshotMetrics: () => ({
        enqueued_total: 0,
        restored_total: 0,
        deduped_total: 0,
        execution_total: 0,
        execution_succeeded_total: 0,
        execution_failed_total: 0,
        queue_depth: 0,
        backpressure_wait_total: 0,
        planner_requests_total: 0,
        planner_failures_total: 0,
        planner_parse_failures_total: 0,
        planner_circuit_open_total: 0,
        planner_latency_ms_total: 0,
        planner_latency_samples: 0,
        battery_throttle_hits_total: 0,
        last_updated_at: "2026-03-07T00:00:00.000Z",
      }),
      adoptPersistedJob: () => {},
    },
    ingestionRuntime: {
      getStatus: () => ({
        mode: runtimeMode,
        running: false,
        workerInitialized: false,
        transitionCount: 1,
        lastTransitionAt: "2026-03-07T00:00:00.000Z",
        lastTransitionSource: "test",
      }),
      setMode: (mode) => {
        runtimeMode = mode;
        return {
          mode: runtimeMode,
          running: mode === "active",
          workerInitialized: false,
          transitionCount: 2,
          lastTransitionAt: "2026-03-07T00:00:01.000Z",
          lastTransitionSource: "test",
        };
      },
    },
    opsPersistenceEnabled: false,
    enqueueOpsCommandWithPersistence: async () => ({
      job: {
        jobId: "job-1",
      },
      deduped: false,
    }),
    hydratePersistedSourceHealthState: async () => [],
    buildThreatSummaryPayload: () => ({
      gate: { action: "LOG_ONLY" },
      summary: {
        top_threat_type: null,
        top_threat_score: null,
        top_recommended_action: null,
        actionable_threat_count: 0,
      },
    }),
    loadDtnIslStatus: async () => ({
      configured: false,
      reachable: false,
      generated_at: null,
      readiness_score: 0,
      pass: 0,
      warn: 0,
      fail: 0,
      controls: [],
      last_error: null,
    }),
    getLastTriadReport: () => null,
    offlineRepairCapsulePath: capsulePath,
    offlineRepairArtifactsDir: artifactsDir,
  });

  const server = http.createServer(app);
  const port = await new Promise<number>((resolve, reject) => {
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

  const request = (method: string, path: string, body?: unknown) =>
    new Promise<{ statusCode: number; payload: unknown }>((resolve, reject) => {
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
          headers: payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : undefined,
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

  try {
    const runtimeResponse = await request("GET", "/api/ops/runtime/status");
    if ((runtimeResponse.payload as { skipped?: boolean })?.skipped) {
      return;
    }
    assert.equal(runtimeResponse.statusCode, 200);
    assert.equal((runtimeResponse.payload as { mode: string }).mode, "suspended");

    const pairingResponse = await request("POST", "/api/ops/repair/offline/pairing");
    assert.equal(pairingResponse.statusCode, 200);
    const pairingPayload = pairingResponse.payload as {
      pairing_summary: { activeBatchId: string; queueDepth: number };
      active_batch: { targets: string[]; pairing: { handoff: Array<{ actor: string }> } };
    };
    assert.equal(pairingPayload.pairing_summary.activeBatchId, "offline-batch-1");
    assert.equal(pairingPayload.pairing_summary.queueDepth, 1);
    assert.deepEqual(pairingPayload.active_batch.targets, ["backend/server.ts"]);
    assert.equal(pairingPayload.active_batch.pairing.handoff[0]?.actor, "orchestrator");

    const repairResponse = await request("POST", "/api/ops/repair/offline/plan", {
      run_validators: false,
    });
    assert.equal(repairResponse.statusCode, 201);
    const repairPayload = repairResponse.payload as {
      pairing: { strategy: string };
      planner: { mode: string; fallback_reason: string | null };
      proposal: { touched_files: string[] };
      validation: { requested: boolean; passed: boolean; results: unknown[] };
      artifact_path: string;
      batch: { batchId: string };
    };
    assert.equal(repairPayload.batch.batchId, "offline-batch-1");
    assert.equal(repairPayload.pairing.strategy, "bounded-dual-lane-repair");
    assert.equal(repairPayload.planner.mode, "deterministic-fallback");
    assert.match(repairPayload.planner.fallback_reason ?? "", /not configured/i);
    assert.deepEqual(repairPayload.proposal.touched_files, ["backend/server.ts"]);
    assert.equal(repairPayload.validation.requested, false);
    assert.equal(repairPayload.validation.passed, true);
    assert.deepEqual(repairPayload.validation.results, []);

    const artifact = JSON.parse(readFileSync(repairPayload.artifact_path, "utf8")) as {
      pairing: { strategy: string };
      planner: { mode: string };
      validation: { scope: string };
    };
    assert.equal(artifact.pairing.strategy, "bounded-dual-lane-repair");
    assert.equal(artifact.planner.mode, "deterministic-fallback");
    assert.equal(artifact.validation.scope, "workspace-baseline");

    const latestResponse = await request("GET", "/api/ops/command/latest");
    assert.equal(latestResponse.statusCode, 200);
    const latestPayload = latestResponse.payload as {
      workers: Array<{ id: string }>;
      brokerPolicy: { autoSafeOps: boolean };
      queuedApprovals: unknown[];
    };
    assert.ok(latestPayload.workers.some((worker) => worker.id === "telemetry-ingest"));
    assert.equal(latestPayload.brokerPolicy.autoSafeOps, true);
    assert.deepEqual(latestPayload.queuedApprovals, []);

    const workerStatusResponse = await request("GET", "/api/ops/control/workers");
    assert.equal(workerStatusResponse.statusCode, 200);
    assert.ok(
      (workerStatusResponse.payload as { workers: Array<{ id: string }> }).workers.some(
        (worker) => worker.id === "ssa-analysis",
      ),
    );

    const dispatchResponse = await request("POST", "/api/ops/control/delegation/dispatch", {
      workerId: "command-planner",
      lane: "runtime",
      kind: "command-request",
      payload: {
        prompt: "Review SSA warning and trigger a nowcast response.",
        anomalyProbability: 0.94,
      },
    });
    assert.equal(dispatchResponse.statusCode, 202);
    assert.equal((dispatchResponse.payload as { result: { queuedApproval: boolean } }).result.queuedApproval, true);

    const queueResponse = await request("GET", "/api/ops/control/delegation/queue");
    assert.equal(queueResponse.statusCode, 200);
    const queuePayload = queueResponse.payload as {
      queuedApprovals: Array<{ taskId: string }>;
    };
    assert.equal(queuePayload.queuedApprovals.length, 1);

    const approveResponse = await request("POST", "/api/ops/control/delegation/approve", {
      taskId: queuePayload.queuedApprovals[0]?.taskId,
    });
    assert.equal(approveResponse.statusCode, 200);
    assert.match(
      String((approveResponse.payload as { result: { summary: string } }).result.summary),
      /approved mission action queued/i,
    );
  } finally {
    await new Promise<void>((resolve) => {
      if (port === -1) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    process.env.ORCHESTRATOR_LOCAL_ENGINE_URL = previousEnv.ORCHESTRATOR_LOCAL_ENGINE_URL;
    process.env.GAUSS_BRAIN_URL = previousEnv.GAUSS_BRAIN_URL;
    process.env.MLX_CHAT_URL = previousEnv.MLX_CHAT_URL;
    process.env.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB = previousEnv.MEMORY_GOVERNOR_NOMINAL_MIN_FREE_MB;
    process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = previousEnv.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB;
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
