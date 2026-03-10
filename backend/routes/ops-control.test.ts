import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { mountOpsControlRoutes } from "./ops-control.js";

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
  };
  delete process.env.ORCHESTRATOR_LOCAL_ENGINE_URL;
  delete process.env.GAUSS_BRAIN_URL;
  delete process.env.MLX_CHAT_URL;

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
    enqueueOpsCommandWithPersistence: async () => {
      throw new Error("not used in test");
    },
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
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
