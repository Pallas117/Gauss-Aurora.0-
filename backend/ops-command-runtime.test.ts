import assert from "node:assert/strict";
import test from "node:test";
import {
  OpsCommandRuntime,
  resolvePlannerModelProfile,
  resolvePlannerPowerState,
  type OpsCommandJobRecord,
} from "./ops-command-runtime.js";

test("resolvePlannerPowerState marks low battery discharging as constrained", () => {
  const state = resolvePlannerPowerState(
    {
      power: {
        batteryPercent: 18,
        charging: false,
        powerSource: "battery",
      },
    },
    {
      ORCHESTRATOR_DISCHARGING_MIN_SAFE_BATTERY_PERCENT: "40",
    } as NodeJS.ProcessEnv,
  );
  assert.equal(state.constrained, true);
  assert.match(state.reason, /battery=/);
});

test("resolvePlannerModelProfile picks low-power model when constrained", () => {
  const profile = resolvePlannerModelProfile(
    "base-model",
    {
      batteryPercent: 15,
      charging: false,
      powerSource: "battery",
      thermalPressure: "nominal",
      constrained: true,
      reason: "battery low",
    },
    {
      ORCHESTRATOR_CHAT_MODEL_LOW_POWER: "low-power-model",
      ORCHESTRATOR_CHAT_MAX_TOKENS_LOW_POWER: "96",
    } as NodeJS.ProcessEnv,
  );
  assert.equal(profile.profile, "low-power");
  assert.equal(profile.model, "low-power-model");
  assert.equal(profile.maxTokens, 96);
});

test("OpsCommandRuntime dedupes jobs with the same idempotency key", async () => {
  const runtime = new OpsCommandRuntime(
    async (job: OpsCommandJobRecord) => ({
      executed: true,
      commandType: job.commandType,
      mode: "live",
      detail: "ok",
      output: {},
    }),
    { maxJobs: 10 },
  );

  const first = runtime.enqueue({
    commandType: "log-health-check",
    payload: {},
    source: "manual",
    simulate: false,
    idempotencyKey: "abc-123",
  });
  const second = runtime.enqueue({
    commandType: "log-health-check",
    payload: {},
    source: "manual",
    simulate: false,
    idempotencyKey: "abc-123",
  });

  assert.equal(second.deduped, true);
  assert.equal(second.job.jobId, first.job.jobId);
});

test("OpsCommandRuntime processes queued jobs to succeeded status", async () => {
  const runtime = new OpsCommandRuntime(async (job: OpsCommandJobRecord) => ({
    executed: true,
    commandType: job.commandType,
    mode: job.simulate ? "deferred" : "live",
    detail: "done",
    output: {},
  }));

  const enqueued = runtime.enqueue({
    commandType: "trigger-nowcast",
    payload: { horizonMinutes: 60 },
    source: "manual",
    simulate: true,
    idempotencyKey: "runtime-process-1",
    heavyCommand: true,
    powerConstrained: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  const job = runtime.getJob(enqueued.job.jobId);
  assert.ok(job);
  assert.equal(job.status, "succeeded");
  const metrics = runtime.snapshotMetrics();
  assert.equal(metrics.execution_total >= 1, true);
  assert.equal(metrics.execution_succeeded_total >= 1, true);
});

test("OpsCommandRuntime adopts persisted planned job and executes it", async () => {
  const runtime = new OpsCommandRuntime(async (job: OpsCommandJobRecord) => ({
    executed: true,
    commandType: job.commandType,
    mode: "deferred",
    detail: "replayed",
    output: { replayed: true },
  }));

  runtime.adoptPersistedJob({
    jobId: "6ee6d8d5-3b0e-447d-b9c2-cf209a0fbeaf",
    commandType: "log-health-check",
    payload: { restored: true },
    source: "manual",
    status: "planned",
    simulate: true,
    idempotencyKey: "persisted-job-1",
    requestedBy: "u1",
    powerConstrained: false,
    heavyCommand: false,
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  });

  await new Promise((resolve) => setTimeout(resolve, 30));

  const job = runtime.getJob("6ee6d8d5-3b0e-447d-b9c2-cf209a0fbeaf");
  assert.ok(job);
  assert.equal(job.status, "succeeded");
  const metrics = runtime.snapshotMetrics();
  assert.equal(metrics.restored_total >= 1, true);
});
