import { randomUUID } from "node:crypto";
import {
  getDevices,
  getTuringDevicePort,
  type TuringDevice,
  type TuringDeviceClass,
} from "./pool.js";

export type TuringAutoscalerMode = "observe" | "managed";
export type TuringResourcePressure = "nominal" | "constrained" | "critical";
export type TuringNetworkHealth = "nominal" | "degraded" | "offline";

export interface TuringAutoscalerPolicy {
  minHealthyNodes: number;
  maxNodes: number;
  scaleOutQueueDepth: number;
  scaleInQueueDepth: number;
  targetJobsPerNode: number;
  cooldownMs: number;
  healCooldownMs: number;
  spacecraftApprovalRequired: boolean;
}

export interface TuringAutoscaleNode {
  id: string;
  deviceClass: TuringDeviceClass;
  approved: boolean;
  healthy: boolean;
  systemCritical: boolean;
  cacheHealthy: boolean;
  batteryPercent: number | null;
  powerSource: "ac" | "battery" | "unknown" | null;
  load: number | null;
  currentJobs: number;
  storeAndForward: boolean;
  linkSecure: boolean;
  tailscaleIp?: string;
}

export interface TuringAutoscaleObservation {
  queueDepth: number;
  activeJobs: number;
  desiredCapacity: number;
  resourcePressure: TuringResourcePressure;
  networkHealth: TuringNetworkHealth;
  nodes: TuringAutoscaleNode[];
  nowMs: number;
  lastScaleMs: number | null;
}

export type TuringAutoscaleActionKind = "scale_out" | "scale_in" | "heal_device" | "require_approval";

export interface TuringAutoscaleAction {
  kind: TuringAutoscaleActionKind;
  nodeId: string | null;
  requestedCapacity?: number;
  applied?: boolean;
  error?: string;
}

export interface TuringAutoscalePlan {
  protocol: "gauss-autoscale-v1";
  mode: TuringAutoscalerMode;
  desiredCapacity: number;
  actions: TuringAutoscaleAction[];
  blockedReason: string | null;
  generatedAt: string;
}

export interface TuringAutoscaleWirePlan {
  protocol: "gauss-autoscale-v1";
  mode: TuringAutoscalerMode;
  desired_capacity: number;
  actions: Array<{
    kind: TuringAutoscaleActionKind;
    node_id: string | null;
    requested_capacity?: number;
    applied?: boolean;
    error?: string;
  }>;
  blocked_reason: string | null;
  generated_at: string;
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(value);
}

function policyFromEnv(): TuringAutoscalerPolicy {
  return {
    minHealthyNodes: Math.max(1, intEnv("TURING_AUTOSCALER_MIN_HEALTHY_NODES", 1)),
    maxNodes: Math.max(1, intEnv("TURING_AUTOSCALER_MAX_NODES", 4)),
    scaleOutQueueDepth: Math.max(1, intEnv("TURING_AUTOSCALER_SCALE_OUT_QUEUE_DEPTH", 2)),
    scaleInQueueDepth: intEnv("TURING_AUTOSCALER_SCALE_IN_QUEUE_DEPTH", 0),
    targetJobsPerNode: Math.max(1, intEnv("TURING_AUTOSCALER_TARGET_JOBS_PER_NODE", 2)),
    cooldownMs: Math.max(0, intEnv("TURING_AUTOSCALER_COOLDOWN_MS", 60_000)),
    healCooldownMs: Math.max(0, intEnv("TURING_AUTOSCALER_HEAL_COOLDOWN_MS", 300_000)),
    spacecraftApprovalRequired: true,
  };
}

function clampCapacity(value: number, policy: TuringAutoscalerPolicy): number {
  return Math.max(policy.minHealthyNodes, Math.min(policy.maxNodes, Math.max(1, Math.floor(value))));
}

export function evaluateTuringAutoscaler(
  observation: TuringAutoscaleObservation,
  policy: TuringAutoscalerPolicy,
  mode: TuringAutoscalerMode,
): TuringAutoscalePlan {
  const actions: TuringAutoscaleAction[] = [];
  let desiredCapacity = clampCapacity(observation.desiredCapacity, policy);
  let blockedReason: string | null = null;

  if (observation.resourcePressure === "critical") {
    blockedReason = "Capacity growth blocked by critical memory/resource pressure.";
  } else if (
    observation.queueDepth >= policy.scaleOutQueueDepth &&
    observation.networkHealth !== "offline" &&
    observation.lastScaleMs == null
  ) {
    const required = Math.ceil(Math.max(observation.queueDepth, observation.activeJobs) / policy.targetJobsPerNode);
    desiredCapacity = clampCapacity(Math.max(desiredCapacity, required), policy);
  }

  if (observation.queueDepth <= policy.scaleInQueueDepth && desiredCapacity > policy.minHealthyNodes) {
    desiredCapacity = policy.minHealthyNodes;
  }

  if (desiredCapacity > observation.desiredCapacity && !blockedReason) {
    actions.push({ kind: "scale_out", nodeId: null, requestedCapacity: desiredCapacity, applied: false });
  } else if (desiredCapacity < observation.desiredCapacity) {
    actions.push({ kind: "scale_in", nodeId: null, requestedCapacity: desiredCapacity, applied: false });
  }

  for (const node of observation.nodes) {
    if (!node.approved || node.healthy && node.cacheHealthy) continue;
    if (node.deviceClass === "spacecraft" && policy.spacecraftApprovalRequired) {
      actions.push({ kind: "require_approval", nodeId: node.id, applied: false, error: "spacecraft recovery requires operator approval" });
    } else if (mode === "managed") {
      actions.push({ kind: "heal_device", nodeId: node.id, applied: false });
    }
  }

  return {
    protocol: "gauss-autoscale-v1",
    mode,
    desiredCapacity,
    actions,
    blockedReason,
    generatedAt: new Date(observation.nowMs).toISOString(),
  };
}

export function toTuringAutoscaleWirePlan(plan: TuringAutoscalePlan): TuringAutoscaleWirePlan {
  return {
    protocol: plan.protocol,
    mode: plan.mode,
    desired_capacity: plan.desiredCapacity,
    actions: plan.actions.map((action) => ({
      kind: action.kind,
      node_id: action.nodeId,
      ...(action.requestedCapacity == null ? {} : { requested_capacity: action.requestedCapacity }),
      ...(action.applied == null ? {} : { applied: action.applied }),
      ...(action.error == null ? {} : { error: action.error }),
    })),
    blocked_reason: plan.blockedReason,
    generated_at: plan.generatedAt,
  };
}

function toAutoscaleNode(device: TuringDevice): TuringAutoscaleNode {
  return {
    id: device.id,
    deviceClass: device.device_class,
    approved: device.approval_status === "approved",
    healthy: device.status === "healthy",
    systemCritical: device.device_class === "spacecraft",
    cacheHealthy: device.cache_healthy !== false,
    batteryPercent: device.battery_percent,
    powerSource: device.power_source,
    load: device.load,
    currentJobs: device.current_jobs ?? 0,
    storeAndForward: device.capabilities.includes("store-and-forward"),
    linkSecure: device.tailscale_ip.startsWith("100."),
    tailscaleIp: device.tailscale_ip,
  };
}

export class TuringAutoscaler {
  private readonly policy = policyFromEnv();
  private lastScaleMs: number | null = null;
  private lastHealMs = new Map<string, number>();
  private lastProvisionRequestId: string | null = null;
  private lastProvisionOutcome: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer || !boolEnv("TURING_AUTOSCALER_ENABLED", false)) return;
    const intervalMs = Math.max(30_000, intEnv("TURING_AUTOSCALER_INTERVAL_MS", 60_000));
    this.timer = setInterval(() => void this.runOnce(0), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): { enabled: boolean; mode: TuringAutoscalerMode; lastProvisionRequestId: string | null; lastProvisionOutcome: string | null } {
    return {
      enabled: boolEnv("TURING_AUTOSCALER_ENABLED", false),
      mode: (process.env.TURING_AUTOSCALER_MODE === "managed" ? "managed" : "observe"),
      lastProvisionRequestId: this.lastProvisionRequestId,
      lastProvisionOutcome: this.lastProvisionOutcome,
    };
  }

  async runOnce(queueDepth: number): Promise<TuringAutoscalePlan> {
    const devices = getDevices();
    const nodes = devices.map(toAutoscaleNode);
    const healthyCapacity = Math.max(this.policy.minHealthyNodes, Math.min(this.policy.maxNodes, nodes.filter((node) => node.approved && node.healthy).length || 1));
    const mode: TuringAutoscalerMode = process.env.TURING_AUTOSCALER_MODE === "managed" ? "managed" : "observe";
    const observation: TuringAutoscaleObservation = {
      queueDepth: Math.max(0, queueDepth),
      activeJobs: nodes.reduce((sum, node) => sum + node.currentJobs, 0),
      desiredCapacity: healthyCapacity,
      resourcePressure: "nominal",
      networkHealth: nodes.some((node) => node.linkSecure) || nodes.length === 0 ? "nominal" : "offline",
      nodes,
      nowMs: Date.now(),
      lastScaleMs: this.lastScaleMs,
    };
    const plan = evaluateTuringAutoscaler(observation, this.policy, mode);
    if (plan.actions.some((action) => action.kind === "scale_out" || action.kind === "scale_in")) {
      this.lastScaleMs = Date.now();
    }

    if (mode === "managed" && boolEnv("TURING_AUTOSCALER_ENABLED", false)) {
      await this.applyActions(plan);
    }
    return plan;
  }

  private async applyActions(plan: TuringAutoscalePlan): Promise<void> {
    for (const action of plan.actions) {
      if (action.kind === "heal_device" && action.nodeId) {
        const node = getDevices().find((candidate) => candidate.id === action.nodeId);
        if (!node || !node.tailscale_ip.startsWith("100.")) {
          action.error = "device is not on the approved tailnet address policy";
          continue;
        }
        const lastHeal = this.lastHealMs.get(node.id) ?? 0;
        if (Date.now() - lastHeal < this.policy.healCooldownMs) {
          action.error = "heal cooldown active";
          continue;
        }
        try {
          const response = await fetch(`http://${node.tailscale_ip}:${getTuringDevicePort()}/heal`, { method: "POST", signal: AbortSignal.timeout(5_000) });
          action.applied = response.ok;
          if (!response.ok) action.error = `heal endpoint returned HTTP ${response.status}`;
          if (response.ok) this.lastHealMs.set(node.id, Date.now());
        } catch (error) {
          action.error = error instanceof Error ? error.message : String(error);
        }
      }
      if (action.kind === "scale_out") {
        const url = (process.env.TURING_AUTOSCALER_PROVISION_URL ?? "").trim();
        if (!url) {
          action.error = "provisioning endpoint is not configured";
          continue;
        }
        const token = (process.env.TURING_AUTOSCALER_PROVISION_TOKEN ?? "").trim();
        if (!token) {
          action.error = "provisioning token is not configured";
          continue;
        }
        const requestId = `gauss-autoscale-${randomUUID().replaceAll("-", "")}`;
        this.lastProvisionRequestId = requestId;
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-Gauss-Autoscale-Protocol": "gauss-autoscale-v1",
              "Idempotency-Key": requestId,
            },
            body: JSON.stringify({ desired_capacity: action.requestedCapacity }),
            signal: AbortSignal.timeout(5_000),
          });
          action.applied = response.ok;
          this.lastProvisionOutcome = response.ok ? "succeeded" : `http_${response.status}`;
          if (!response.ok) action.error = `provisioning endpoint returned HTTP ${response.status}`;
        } catch (error) {
          action.error = error instanceof Error ? error.message : String(error);
          this.lastProvisionOutcome = "failed";
        }
      }
    }
  }
}

let autoscaler: TuringAutoscaler | null = null;

export function getTuringAutoscaler(): TuringAutoscaler {
  autoscaler ??= new TuringAutoscaler();
  return autoscaler;
}
