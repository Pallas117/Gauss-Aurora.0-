import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const KALI_SUPERVISOR_SCHEMA = "gauss-kali-supervisor-v1";
const MAX_REPORT_BYTES = 256 * 1024;

export type KaliSupervisorReport = {
  schema: typeof KALI_SUPERVISOR_SCHEMA;
  generated_at: string;
  node: {
    hostname: string;
    tailscale_ip: string | null;
  };
  overall: "healthy" | "degraded" | "blocked";
  policy: {
    network_only_backend: boolean;
    public_ingress_allowed: false;
    spacecraft_actions_allowed: false;
    safe_action_mode: string;
    secrets_in_report: false;
  };
  checks: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  blockers: string[];
};

function reportPath(): string {
  const configured = (process.env.GAUSS_KALI_REPORT_FILE ?? "").trim();
  if (configured) return path.resolve(configured.replace(/^~(?=\/)/, os.homedir()));
  return path.join(os.homedir(), ".local", "state", "gauss-kali-supervisor", "latest.json");
}

function boundedString(value: unknown, max = 512): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function recordArray(value: unknown, max: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    .map((entry) => {
      const copy: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(entry).slice(0, 24)) {
        if (typeof raw === "string") copy[key.slice(0, 64)] = raw.slice(0, 512);
        else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) copy[key.slice(0, 64)] = raw;
        else if (Array.isArray(raw)) copy[key.slice(0, 64)] = raw.slice(0, 32);
      }
      return copy;
    });
}

export function readKaliSupervisorReport(filePath = reportPath()): KaliSupervisorReport | null {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REPORT_BYTES) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (parsed.schema !== KALI_SUPERVISOR_SCHEMA) return null;
    const overall = parsed.overall;
    if (overall !== "healthy" && overall !== "degraded" && overall !== "blocked") return null;
    const node = parsed.node && typeof parsed.node === "object" && !Array.isArray(parsed.node)
      ? parsed.node as Record<string, unknown>
      : {};
    const policy = parsed.policy && typeof parsed.policy === "object" && !Array.isArray(parsed.policy)
      ? parsed.policy as Record<string, unknown>
      : {};
    return {
      schema: KALI_SUPERVISOR_SCHEMA,
      generated_at: boundedString(parsed.generated_at, 64),
      node: {
        hostname: boundedString(node.hostname, 128),
        tailscale_ip: typeof node.tailscale_ip === "string" ? node.tailscale_ip.slice(0, 64) : null,
      },
      overall,
      policy: {
        network_only_backend: policy.network_only_backend === true,
        public_ingress_allowed: false,
        spacecraft_actions_allowed: false,
        safe_action_mode: boundedString(policy.safe_action_mode, 64),
        secrets_in_report: false,
      },
      checks: recordArray(parsed.checks, 128),
      metrics: policyRecord(parsed.metrics),
      actions: recordArray(parsed.actions, 32),
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.filter((value): value is string => typeof value === "string").slice(0, 32).map((value) => value.slice(0, 512))
        : [],
    };
  } catch {
    return null;
  }
}

function policyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 64)) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      output[key.slice(0, 64)] = raw;
    } else if (Array.isArray(raw)) {
      output[key.slice(0, 64)] = raw.slice(0, 64);
    }
  }
  return output;
}

export function kaliSupervisorReportPath(): string {
  return reportPath();
}
