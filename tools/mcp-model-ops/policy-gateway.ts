import { createHash } from "node:crypto";

export interface McpPolicyContext {
  toolName: string;
  airGapEnabled: boolean;
  allowTailscale: boolean;
}

export interface McpPolicyDecision {
  allowed: boolean;
  reason: string;
  endpoint?: string | null;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function buildPolicyContext(toolName: string): McpPolicyContext {
  return {
    toolName,
    airGapEnabled: isTruthy(process.env.GAUSS_AIR_GAP ?? "1"),
    allowTailscale: isTruthy(process.env.GAUSS_ALLOW_TAILSCALE),
  };
}

export function hashPayload(payload: unknown): string {
  const digest = createHash("sha256");
  digest.update(JSON.stringify(payload ?? {}));
  return digest.digest("hex");
}

export function validateEndpoint(url: string, context: McpPolicyContext): McpPolicyDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "invalid endpoint URL", endpoint: url };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: "unsupported endpoint protocol", endpoint: parsed.toString() };
  }

  const host = parsed.hostname;
  const isLoopback = host === "127.0.0.1" || host === "localhost";
  const isTailscale = host.startsWith("100.");

  if (context.airGapEnabled) {
    if (isLoopback) {
      return { allowed: true, reason: "air-gap local loopback allow", endpoint: parsed.toString() };
    }
    return { allowed: false, reason: "air-gap mode blocks non-loopback endpoint", endpoint: parsed.toString() };
  }

  if (isLoopback) {
    return { allowed: true, reason: "loopback allow", endpoint: parsed.toString() };
  }
  if (isTailscale && context.allowTailscale) {
    return { allowed: true, reason: "tailscale allow", endpoint: parsed.toString() };
  }
  return {
    allowed: false,
    reason: context.allowTailscale
      ? "endpoint host outside loopback/tailscale allowlist"
      : "endpoint host outside loopback allowlist",
    endpoint: parsed.toString(),
  };
}

