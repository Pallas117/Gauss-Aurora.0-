import { randomUUID } from "node:crypto";
import { getDevices, getTuringDevicePort, type TuringDevice } from "./pool.js";

const MAX_JOBS = 256;
const MAX_SAMPLES_PER_JOB = 512;
const MAX_DRAIN_JOBS = 16;

export interface RadiationWorkSample {
  [key: string]: unknown;
}

export interface RadiationWorkRequest {
  samples: RadiationWorkSample[];
  source?: string;
  window_start?: string;
  window_end?: string;
  priority?: number;
  required_memory_mb?: number;
  min_battery_percent?: number;
  max_attempts?: number;
}

export type RadiationWorkStatus = "queued" | "running" | "completed" | "failed";

export interface RadiationWorkJob {
  id: string;
  protocol: "gauss-radiation-work-v1";
  status: RadiationWorkStatus;
  source: string;
  samples: RadiationWorkSample[];
  window_start: string | null;
  window_end: string | null;
  priority: number;
  required_memory_mb: number;
  min_battery_percent: number;
  max_attempts: number;
  attempts: number;
  device_id: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const jobs = new Map<string, RadiationWorkJob>();
const queue: string[] = [];
const credits = new Map<string, number>();
let roundRobinCursor = 0;

function now(): string {
  return new Date().toISOString();
}

function boundedText(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function eligibleDevices(job: RadiationWorkJob): TuringDevice[] {
  return getDevices()
    .filter((device) => {
      if (device.approval_status !== "approved" || device.status !== "healthy") return false;
      if (!device.tailscale_ip.startsWith("100.")) return false;
      if (!device.capabilities.includes("batch") && !device.capabilities.includes("compute")) return false;
      if (device.battery_percent != null && device.battery_percent < job.min_battery_percent) return false;
      if (job.required_memory_mb > 0 && device.ram_mb != null && device.ram_mb < job.required_memory_mb) return false;
      return true;
    })
    .sort((a, b) => (a.current_jobs ?? 0) - (b.current_jobs ?? 0));
}

function selectDevice(job: RadiationWorkJob, used: Set<string>): TuringDevice | null {
  const devices = eligibleDevices(job);
  if (devices.length === 0) return null;
  const unused = devices.filter((device) => !used.has(device.id));
  const pool = unused.length > 0 ? unused : devices;
  const device = pool[roundRobinCursor % pool.length] ?? null;
  roundRobinCursor += 1;
  return device;
}

export function enqueueRadiationWork(request: RadiationWorkRequest): RadiationWorkJob {
  if (jobs.size >= MAX_JOBS) throw new Error("radiation work queue capacity reached");
  if (!Array.isArray(request.samples) || request.samples.length === 0) throw new Error("samples are required");
  if (request.samples.length > MAX_SAMPLES_PER_JOB) throw new Error(`samples exceed ${MAX_SAMPLES_PER_JOB} per job`);
  const timestamp = now();
  const job: RadiationWorkJob = {
    id: `radiation-${randomUUID()}`,
    protocol: "gauss-radiation-work-v1",
    status: "queued",
    source: boundedText(request.source, 200, "operator"),
    samples: request.samples.slice(0, MAX_SAMPLES_PER_JOB),
    window_start: boundedText(request.window_start, 64, "") || null,
    window_end: boundedText(request.window_end, 64, "") || null,
    priority: Math.max(0, Math.min(100, Math.floor(request.priority ?? 50))),
    required_memory_mb: Math.max(0, Math.min(65_536, Math.floor(request.required_memory_mb ?? 0))),
    min_battery_percent: Math.max(0, Math.min(100, Math.floor(request.min_battery_percent ?? 25))),
    max_attempts: Math.max(1, Math.min(3, Math.floor(request.max_attempts ?? 2))),
    attempts: 0,
    device_id: null,
    result: null,
    error: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  return { ...job, samples: job.samples.slice() };
}

export async function drainRadiationWorkQueue(maxJobs = MAX_DRAIN_JOBS): Promise<{ attempted: number; completed: number; failed: number; deferred: number }> {
  const limit = Math.max(1, Math.min(MAX_DRAIN_JOBS, Math.floor(maxJobs)));
  const used = new Set<string>();
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  const deferred: string[] = [];

  while (queue.length > 0 && attempted < limit) {
    const id = queue.shift();
    if (!id) break;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    const device = selectDevice(job, used);
    if (!device) {
      deferred.push(id);
      continue;
    }
    used.add(device.id);
    attempted += 1;
    job.status = "running";
    job.attempts += 1;
    job.device_id = device.id;
    job.updated_at = now();
    try {
      const response = await fetch(`http://${device.tailscale_ip}:${getTuringDevicePort()}/compute/job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          type: "batch",
          payload: { protocol: job.protocol, work_id: job.id, samples: job.samples },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`compute endpoint returned HTTP ${response.status}`);
      const payload = (await response.json()) as { status?: string; result?: { compute_credit_units?: number } };
      if (payload.status === "failed") throw new Error("compute endpoint reported failure");
      job.status = "completed";
      job.result = payload.result ?? payload;
      job.error = null;
      const creditUnits = Number(payload.result?.compute_credit_units ?? job.samples.length);
      credits.set(device.id, (credits.get(device.id) ?? 0) + (Number.isFinite(creditUnits) ? Math.max(0, creditUnits) : 0));
      completed += 1;
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      if (job.attempts < job.max_attempts) {
        job.status = "queued";
        queue.push(job.id);
      } else {
        job.status = "failed";
        failed += 1;
      }
    }
    job.updated_at = now();
  }
  queue.push(...deferred);
  return { attempted, completed, failed, deferred: deferred.length + queue.length };
}

export function getRadiationWorkJob(id: string): RadiationWorkJob | null {
  const job = jobs.get(id);
  return job ? { ...job, samples: job.samples.slice() } : null;
}

export function listRadiationWorkJobs(limit = 50): RadiationWorkJob[] {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  return Array.from(jobs.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, bounded).map((job) => ({ ...job, samples: job.samples.slice() }));
}

export function getRadiationWorkSummary() {
  const list = Array.from(jobs.values());
  return {
    total: list.length,
    queued: list.filter((job) => job.status === "queued").length,
    running: list.filter((job) => job.status === "running").length,
    completed: list.filter((job) => job.status === "completed").length,
    failed: list.filter((job) => job.status === "failed").length,
    total_samples_processed: list.filter((job) => job.status === "completed").reduce((sum, job) => sum + job.samples.length, 0),
    credits: Array.from(credits, ([device_id, credit_units]) => ({ device_id, credit_units })),
  };
}

export function getRadiationWorkCapacitySnapshot() {
  const devices = getDevices();
  return {
    protocol: "gauss-radiation-work-v1",
    max_jobs: MAX_JOBS,
    queue_depth: queue.length,
    eligible_devices: eligibleDevices({ min_battery_percent: 25, required_memory_mb: 0 } as RadiationWorkJob).length,
    approved_devices: devices.filter((device) => device.approval_status === "approved").length,
  };
}

export function clearRadiationWorkForTests(): void {
  jobs.clear();
  queue.length = 0;
  credits.clear();
  roundRobinCursor = 0;
}

export function startRadiationWorkScheduler(): void {
  // Dispatch remains explicit/observe-only; no background work is admitted.
}

export function stopRadiationWorkScheduler(): void {
  // Reserved for a future approved scheduler; intentionally no-op in v1.
}
