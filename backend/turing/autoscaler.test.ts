import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTuringAutoscaler,
  TuringAutoscaler,
  toTuringAutoscaleWirePlan,
  type TuringAutoscaleNode,
  type TuringAutoscaleObservation,
  type TuringAutoscalerPolicy,
} from "./autoscaler.js";
import { approveDevice, heartbeat, register, removeDevice } from "./pool.js";

const policy: TuringAutoscalerPolicy = {
  minHealthyNodes: 1,
  maxNodes: 2,
  scaleOutQueueDepth: 2,
  scaleInQueueDepth: 0,
  targetJobsPerNode: 2,
  cooldownMs: 60_000,
  healCooldownMs: 300_000,
  spacecraftApprovalRequired: true,
};

function node(id: string, deviceClass: TuringAutoscaleNode["deviceClass"], healthy = true): TuringAutoscaleNode {
  return {
    id,
    deviceClass,
    approved: true,
    healthy,
    systemCritical: !healthy,
    cacheHealthy: healthy,
    batteryPercent: 90,
    powerSource: "ac",
    load: 0.2,
    currentJobs: 0,
    storeAndForward: false,
    linkSecure: true,
  };
}

function observation(overrides: Partial<TuringAutoscaleObservation> = {}): TuringAutoscaleObservation {
  return {
    queueDepth: 0,
    activeJobs: 0,
    desiredCapacity: 1,
    resourcePressure: "nominal",
    networkHealth: "nominal",
    nodes: [node("linux-1", "linux")],
    nowMs: 100_000,
    lastScaleMs: null,
    ...overrides,
  };
}

test("autoscaler scales out only within the configured capacity bound", () => {
  const plan = evaluateTuringAutoscaler(observation({ queueDepth: 8, activeJobs: 8 }), policy, "observe");
  assert.equal(plan.desiredCapacity, 2);
  assert.equal(plan.actions.some((action) => action.kind === "scale_out"), true);
  assert.equal(plan.protocol, "gauss-autoscale-v1");
  assert.equal(toTuringAutoscaleWirePlan(plan).desired_capacity, 2);
  assert.equal(toTuringAutoscaleWirePlan(plan).actions[0]?.node_id, null);
});

test("critical memory blocks capacity growth while retaining a truthful plan", () => {
  const plan = evaluateTuringAutoscaler(
    observation({ queueDepth: 20, activeJobs: 20, resourcePressure: "critical" }),
    policy,
    "observe",
  );
  assert.equal(plan.desiredCapacity, 1);
  assert.match(plan.blockedReason ?? "", /critical/i);
  assert.equal(plan.actions.some((action) => action.kind === "scale_out"), false);
});

test("spacecraft recovery is approval-gated and non-spacecraft nodes can heal", () => {
  const plan = evaluateTuringAutoscaler(
    observation({
      nodes: [node("sc-1", "spacecraft", false), node("rack-1", "server-rack", false)],
    }),
    policy,
    "managed",
  );
  assert.equal(plan.actions.some((action) => action.kind === "require_approval" && action.nodeId === "sc-1"), true);
  assert.equal(plan.actions.some((action) => action.kind === "heal_device" && action.nodeId === "rack-1"), true);
});

test("managed mode self-heals an approved non-spacecraft device through the bounded endpoint", async () => {
  const previousEnabled = process.env.TURING_AUTOSCALER_ENABLED;
  const previousMode = process.env.TURING_AUTOSCALER_MODE;
  const previousPolicy = process.env.TURING_DEVICE_IP_POLICY;
  const previousFetch = globalThis.fetch;
  process.env.TURING_AUTOSCALER_ENABLED = "true";
  process.env.TURING_AUTOSCALER_MODE = "managed";
  process.env.TURING_DEVICE_IP_POLICY = "tailnet";
  const registration = register({
    hostname: "autoscale-rack",
    tailscale_ip: "100.99.0.90",
    capabilities: ["compute"],
    device_class: "server-rack",
  });
  approveDevice(registration.id);
  heartbeat({ device_id: registration.id, cache_healthy: false });
  let healCalls = 0;
  globalThis.fetch = (async () => {
    healCalls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const autoscaler = new TuringAutoscaler();
    const plan = await autoscaler.runOnce(0);
    assert.equal(healCalls, 1);
    assert.equal(plan.actions.some((action) => action.kind === "heal_device" && action.applied), true);
  } finally {
    removeDevice(registration.id);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.TURING_AUTOSCALER_ENABLED;
    else process.env.TURING_AUTOSCALER_ENABLED = previousEnabled;
    if (previousMode === undefined) delete process.env.TURING_AUTOSCALER_MODE;
    else process.env.TURING_AUTOSCALER_MODE = previousMode;
    if (previousPolicy === undefined) delete process.env.TURING_DEVICE_IP_POLICY;
    else process.env.TURING_DEVICE_IP_POLICY = previousPolicy;
  }
});

test("managed capacity provisioning fails closed without a token and uses bounded idempotent auth", async () => {
  const previousEnabled = process.env.TURING_AUTOSCALER_ENABLED;
  const previousMode = process.env.TURING_AUTOSCALER_MODE;
  const previousPolicy = process.env.TURING_DEVICE_IP_POLICY;
  const previousUrl = process.env.TURING_AUTOSCALER_PROVISION_URL;
  const previousToken = process.env.TURING_AUTOSCALER_PROVISION_TOKEN;
  const previousCriticalMemory = process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB;
  const previousFetch = globalThis.fetch;
  process.env.TURING_AUTOSCALER_ENABLED = "true";
  process.env.TURING_AUTOSCALER_MODE = "managed";
  process.env.TURING_DEVICE_IP_POLICY = "tailnet";
  process.env.TURING_AUTOSCALER_PROVISION_URL = "https://provisioner.example.test/apply";
  process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = "0";
  delete process.env.TURING_AUTOSCALER_PROVISION_TOKEN;

  const registration = register({
    hostname: "autoscale-provisioner-test",
    tailscale_ip: "100.99.0.91",
    capabilities: ["compute"],
    device_class: "linux",
  });
  approveDevice(registration.id);
  heartbeat({
    device_id: registration.id,
    ram_used_percent: 20,
    cache_healthy: true,
    battery_percent: 95,
    power_source: "ac",
    sequence: 1,
  });

  let calls = 0;
  let requestHeaders: Headers | null = null;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const blocked = await new TuringAutoscaler().runOnce(8);
    const blockedAction = blocked.actions.find((action) => action.kind === "scale_out");
    assert.equal(calls, 0);
    assert.equal(blockedAction?.applied, false);
    assert.match(blockedAction?.error ?? "", /token is not configured/i);

    process.env.TURING_AUTOSCALER_PROVISION_TOKEN = "test-token";
    const provisionedAutoscaler = new TuringAutoscaler();
    const provisioned = await provisionedAutoscaler.runOnce(8);
    const provisionedAction = provisioned.actions.find((action) => action.kind === "scale_out");
    const status = provisionedAutoscaler.status();
    assert.equal(calls, 1);
    assert.equal(provisionedAction?.applied, true);
    assert.equal(requestHeaders?.get("authorization"), "Bearer test-token");
    assert.equal(requestHeaders?.get("x-gauss-autoscale-protocol"), "gauss-autoscale-v1");
    assert.equal(requestHeaders?.get("idempotency-key"), status.lastProvisionRequestId);
    assert.match(status.lastProvisionRequestId ?? "", /^gauss-autoscale-[a-f0-9]{32}$/);
    assert.equal(status.lastProvisionOutcome, "succeeded");
  } finally {
    removeDevice(registration.id);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.TURING_AUTOSCALER_ENABLED;
    else process.env.TURING_AUTOSCALER_ENABLED = previousEnabled;
    if (previousMode === undefined) delete process.env.TURING_AUTOSCALER_MODE;
    else process.env.TURING_AUTOSCALER_MODE = previousMode;
    if (previousPolicy === undefined) delete process.env.TURING_DEVICE_IP_POLICY;
    else process.env.TURING_DEVICE_IP_POLICY = previousPolicy;
    if (previousUrl === undefined) delete process.env.TURING_AUTOSCALER_PROVISION_URL;
    else process.env.TURING_AUTOSCALER_PROVISION_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURING_AUTOSCALER_PROVISION_TOKEN;
    else process.env.TURING_AUTOSCALER_PROVISION_TOKEN = previousToken;
    if (previousCriticalMemory === undefined) delete process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB;
    else process.env.MEMORY_GOVERNOR_CRITICAL_MAX_FREE_MB = previousCriticalMemory;
  }
});
