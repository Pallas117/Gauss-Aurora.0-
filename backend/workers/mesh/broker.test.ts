import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerMeshBroker } from "./registry.js";
import { createWorkerTaskEnvelope } from "./broker.js";
import { resetSpaceDomainStore } from "../../ssa/space-domain-store.js";

function createBroker() {
  return createWorkerMeshBroker({
    ingestionRuntime: {
      getStatus: () => ({
        mode: "active",
        running: true,
        workerInitialized: true,
        transitionCount: 1,
        lastTransitionAt: "2026-03-12T00:00:00.000Z",
        lastTransitionSource: "test",
      }),
      setMode: (mode) => ({
        mode,
        running: mode === "active",
        workerInitialized: true,
        transitionCount: 2,
        lastTransitionAt: "2026-03-12T00:00:01.000Z",
        lastTransitionSource: "test",
      }),
    },
    enqueueOpsCommandWithPersistence: async () => ({
      job: { jobId: "job-1" },
      deduped: false,
    }),
  });
}

test.beforeEach(() => {
  resetSpaceDomainStore();
});

test("broker dispatches telemetry refresh through ingest and bounded handoffs", async () => {
  const broker = createBroker();
  await broker.dispatch(
    createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "telemetry-refresh",
      source: "runtime",
      memory: {
        level: "nominal",
      },
    }),
    { followHandoffs: true },
  );

  const workers = broker.listWorkers();
  assert.equal(
    workers.find((worker) => worker.id === "telemetry-ingest")?.lastResult?.status,
    "completed",
  );
  assert.equal(
    workers.find((worker) => worker.id === "source-policy")?.lastResult?.status,
    "completed",
  );
  assert.equal(
    workers.find((worker) => worker.id === "ssa-analysis")?.lastResult?.status,
    "completed",
  );
  assert.equal(
    workers.find((worker) => worker.id === "command-planner")?.lastResult,
    null,
  );
});

test("broker blocks command planner while RAM is critical", async () => {
  const broker = createBroker();
  const execution = await broker.dispatch(
    createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "command-request",
      source: "runtime",
      requestedWorkerId: "command-planner",
      memory: {
        level: "critical",
      },
      payload: {
        prompt: "Review SSA anomaly and queue a mission action.",
        anomalyProbability: 0.93,
      },
    }),
  );

  assert.equal(execution.result.status, "blocked");
  assert.match(execution.result.summary, /suspended by the RAM governor/i);
});

test("command planner queues mission actions for approval instead of auto-executing them", async () => {
  const broker = createBroker();
  const execution = await broker.dispatch(
    createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "command-request",
      source: "command-ui",
      requestedWorkerId: "command-planner",
      memory: {
        level: "nominal",
      },
      actor: {
        userId: "operator-1",
        role: "operator",
      },
      payload: {
        prompt: "Review SSA warning and trigger a nowcast response.",
        anomalyProbability: 0.94,
      },
    }),
  );

  assert.equal(execution.result.status, "deferred");
  assert.equal(execution.result.queuedApproval, true);
  assert.equal(broker.getQueue().queuedApprovals.length, 1);
});

test("safe executor only runs allowlisted housekeeping actions", async () => {
  const broker = createBroker();
  const allowed = await broker.dispatch(
    createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "command-request",
      requestedWorkerId: "safe-executor",
      memory: {
        level: "nominal",
      },
      payload: {
        action: {
          kind: "log-health-check",
        },
      },
    }),
  );
  const blocked = await broker.dispatch(
    createWorkerTaskEnvelope({
      lane: "runtime",
      kind: "command-request",
      requestedWorkerId: "safe-executor",
      memory: {
        level: "nominal",
      },
      payload: {
        action: {
          kind: "unknown",
        },
      },
    }),
  );

  assert.equal(allowed.result.status, "completed");
  assert.equal(blocked.result.status, "blocked");
});
