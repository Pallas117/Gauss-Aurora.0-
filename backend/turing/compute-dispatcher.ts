/**
 * Turing pool: dispatch compute jobs to a device.
 * Device contract: POST /compute/job, GET /compute/job/:job_id
 */

import { selectDeviceForCompute, getDeviceById } from "./pool.js";
import { getDeviceBaseUrl } from "./cache-proxy.js";

const JOB_TIMEOUT_MS = 120_000;

/** Inference: run on devices with inference/compute. Training: run on devices with batch/compute. */
export type ComputeJobType =
  | "inference"
  | "batch"
  | "surya_forecast"
  | "surya_flare"
  | "surya_finetune"
  | "nowcast_retrain";

export interface ComputeJobRequest {
  job_id: string;
  type: ComputeJobType;
  payload: unknown;
}

/** Map job type to device selection capability (inference vs batch). */
export function computeCapabilityForType(type: ComputeJobType): "inference" | "batch" {
  if (type === "surya_forecast" || type === "surya_flare" || type === "inference") return "inference";
  return "batch";
}

export interface ComputeJobResponse {
  job_id: string;
  status: "accepted" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export async function dispatchComputeJob(
  type: ComputeJobType,
  payload: unknown,
  preferredDeviceId?: string | null
): Promise<{ device_id: string; job_id: string; response: ComputeJobResponse } | null> {
  const capability = computeCapabilityForType(type);
  const device = selectDeviceForCompute(capability, preferredDeviceId);
  if (!device) return null;
  const base = getDeviceBaseUrl(device.id);
  if (!base) return null;

  const job_id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const url = `${base}/compute/job`;
  const body: ComputeJobRequest = { job_id, type, payload };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`compute POST ${res.status}`);
    const response = (await res.json()) as ComputeJobResponse;
    return { device_id: device.id, job_id, response };
  } catch {
    return null;
  }
}

export async function getComputeJobStatus(
  deviceId: string,
  jobId: string
): Promise<ComputeJobResponse | null> {
  const base = getDeviceBaseUrl(deviceId);
  if (!base) return null;
  const url = `${base}/compute/job/${encodeURIComponent(jobId)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as ComputeJobResponse;
  } catch {
    return null;
  }
}
