/**
 * Local multi-node harness for the radiation compute exchange.
 * No sockets, Tailscale, cloud, or model dependencies are used.
 */
import assert from "node:assert/strict";
import {
  approveDevice,
  heartbeat,
  register,
  removeDevice,
} from "../turing/pool.js";
import {
  clearRadiationWorkForTests,
  drainRadiationWorkQueue,
  enqueueRadiationWork,
  getRadiationWorkJob,
  getRadiationWorkSummary,
} from "../turing/radiation-work.js";

const previousPolicy = process.env.TURING_DEVICE_IP_POLICY;
const previousMax = process.env.TURING_POOL_MAX_DEVICES;
const previousFetch = globalThis.fetch;
process.env.TURING_DEVICE_IP_POLICY = "tailnet";
process.env.TURING_POOL_MAX_DEVICES = "0";
clearRadiationWorkForTests();

function createNode(hostname: string, ip: string, battery: number): string {
  const registration = register({
    hostname,
    tailscale_ip: ip,
    ram_mb: 4096,
    capabilities: ["batch", "compute"],
    device_class: "linux",
    transports: ["tailscale"],
  });
  approveDevice(registration.id);
  heartbeat({
    device_id: registration.id,
    ram_used_mb: 512,
    ram_used_percent: 12,
    current_jobs: 0,
    battery_percent: battery,
    charging: false,
    power_source: "battery",
    network_latency_ms: 20,
    network_packet_loss_percent: 0,
    network_health: "nominal",
  });
  return registration.id;
}

const nodes = [
  createNode("harness-node-a", "100.99.0.81", 90),
  createNode("harness-node-b", "100.99.0.82", 80),
];

globalThis.fetch = (async (input, init) => {
  if (String(input).endsWith("/heal")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const body = JSON.parse(String(init?.body ?? "{}")) as { work_id?: string };
  const workId = body.work_id ?? "harness-job";
  return new Response(JSON.stringify({
    job_id: workId,
    status: "completed",
    result: {
      protocol: "gauss-radiation-work-v1",
      work_id: workId,
      samples_processed: 2,
      screening_state: "nominal",
      mean_flux: 2,
      peak_flux: 3,
      mean_energy_mev: 4,
      band_flux: { low: 4 },
      quality: "complete",
      limitations: [],
      compute_credit_units: 2,
    },
  }), { status: 200 });
}) as typeof fetch;

try {
  const first = enqueueRadiationWork({
    source: "harness",
    samples: [
      { energy_mev: 2, flux: 1 },
      { energy_mev: 4, flux: 3 },
    ],
  });
  const second = enqueueRadiationWork({
    source: "harness",
    samples: [
      { energy_mev: 20, flux: 2 },
      { energy_mev: 40, flux: 4 },
    ],
  });
  const drain = await drainRadiationWorkQueue(2);
  const firstJob = getRadiationWorkJob(first.id);
  const secondJob = getRadiationWorkJob(second.id);
  assert.equal(drain.completed, 2);
  assert.equal(firstJob?.status, "completed");
  assert.equal(secondJob?.status, "completed");
  assert.notEqual(firstJob?.device_id, secondJob?.device_id);
  const summary = getRadiationWorkSummary();
  assert.equal(summary.total_samples_processed, 4);
  assert.equal(summary.credits.length, 2);
  console.log("gauss-radiation-work-v1 multi-node harness: PASS");
  console.log(`nodes=${nodes.length} completed=${summary.completed} samples=${summary.total_samples_processed} credits=${summary.credits.reduce((total, credit) => total + credit.credit_units, 0)}`);
} finally {
  clearRadiationWorkForTests();
  for (const id of nodes) removeDevice(id);
  globalThis.fetch = previousFetch;
  if (previousPolicy === undefined) delete process.env.TURING_DEVICE_IP_POLICY;
  else process.env.TURING_DEVICE_IP_POLICY = previousPolicy;
  if (previousMax === undefined) delete process.env.TURING_POOL_MAX_DEVICES;
  else process.env.TURING_POOL_MAX_DEVICES = previousMax;
}
