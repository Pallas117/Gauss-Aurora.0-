export type ProcessingMode = "local" | "hybrid" | "network";

function envBool(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(value);
}

function resolveMode(): ProcessingMode {
  const configured = (process.env.GAUSS_PROCESSING_MODE ?? "").trim().toLowerCase();
  if (configured === "network") return "network";
  if (configured === "hybrid") return "hybrid";
  if (configured === "local") return "local";
  return envBool("GAUSS_AIR_GAP", true) ? "local" : "hybrid";
}

export function getProcessingStatus() {
  const mode = resolveMode();
  const networkUrl = (process.env.GAUSS_NETWORK_PROCESSING_URL ?? "").trim();
  return {
    mode,
    local: mode === "local" || mode === "hybrid",
    network: mode === "network" || mode === "hybrid",
    air_gapped: envBool("GAUSS_AIR_GAP", true),
    network_endpoint_configured: Boolean(networkUrl),
    state: mode === "local" || networkUrl ? "nominal" : "degraded",
  } as const;
}
