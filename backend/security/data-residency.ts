type SensitiveDataMode = "local" | "hybrid" | "network_only";
type PolicyState = "nominal" | "degraded" | "blocked";

export type DataResidencyStatus = {
  mode: SensitiveDataMode;
  deployment_role: string;
  network_only: boolean;
  network_processing_configured: boolean;
  sensitive_store_configured: boolean;
  sensitive_store_pqc_required: boolean;
  sensitive_store_pqc_profile: string | null;
  identity_pqc_gateway_required: boolean;
  local_sensitive_writes_allowed: boolean;
  local_fallback_allowed: boolean;
  state: PolicyState;
  blockers: string[];
};

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

function envBool(key: string, fallback: boolean): boolean {
  const value = env(key).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function mode(): SensitiveDataMode {
  const value = env("GAUSS_SENSITIVE_DATA_MODE").toLowerCase();
  if (value === "network_only") return "network_only";
  if (value === "hybrid") return "hybrid";
  return "local";
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function policyBlockers(): string[] {
  if (mode() !== "network_only") return [];

  const blockers: string[] = [];
  const processingUrl = env("GAUSS_NETWORK_PROCESSING_URL");
  const sensitiveStoreUrl = env("GAUSS_SENSITIVE_STORE_URL");
  const sensitiveStorePqcProfile = env("GAUSS_SENSITIVE_STORE_PQC_PROFILE");
  const identityProfile = env("STAFF_AUTH_CRYPTO_PROFILE");

  if (!isHttpsUrl(processingUrl)) blockers.push("GAUSS_NETWORK_PROCESSING_URL must be an HTTPS endpoint");
  if (!isHttpsUrl(sensitiveStoreUrl)) blockers.push("GAUSS_SENSITIVE_STORE_URL must be an HTTPS endpoint");
  if (!envBool("GAUSS_SENSITIVE_STORE_PQC_REQUIRED", false)) {
    blockers.push("GAUSS_SENSITIVE_STORE_PQC_REQUIRED must be true");
  }
  if (!sensitiveStorePqcProfile) blockers.push("GAUSS_SENSITIVE_STORE_PQC_PROFILE is required");
  if (!envBool("STAFF_AUTH_PQC_GATEWAY_REQUIRED", false)) {
    blockers.push("STAFF_AUTH_PQC_GATEWAY_REQUIRED must be true");
  }
  if (!identityProfile) blockers.push("STAFF_AUTH_CRYPTO_PROFILE is required");
  if (envBool("GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK", true)) {
    blockers.push("GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK must be false");
  }
  if (envBool("GAUSS_LOCAL_SENSITIVE_WRITES", true)) {
    blockers.push("GAUSS_LOCAL_SENSITIVE_WRITES must be false");
  }

  return blockers;
}

export function isNetworkOnlySensitiveData(): boolean {
  return mode() === "network_only";
}

export function getDataResidencyStatus(): DataResidencyStatus {
  const currentMode = mode();
  const blockers = policyBlockers();
  const networkOnly = currentMode === "network_only";
  const processingConfigured = isHttpsUrl(env("GAUSS_NETWORK_PROCESSING_URL"));
  const storeConfigured = isHttpsUrl(env("GAUSS_SENSITIVE_STORE_URL"));
  const pqcRequired = envBool("GAUSS_SENSITIVE_STORE_PQC_REQUIRED", false);
  const identityGatewayRequired = envBool("STAFF_AUTH_PQC_GATEWAY_REQUIRED", false);
  const localWrites = envBool("GAUSS_LOCAL_SENSITIVE_WRITES", true);
  const localFallback = envBool("GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK", true);

  return {
    mode: currentMode,
    deployment_role: env("GAUSS_DEPLOYMENT_ROLE") || "local",
    network_only: networkOnly,
    network_processing_configured: processingConfigured,
    sensitive_store_configured: storeConfigured,
    sensitive_store_pqc_required: pqcRequired,
    sensitive_store_pqc_profile: env("GAUSS_SENSITIVE_STORE_PQC_PROFILE") || null,
    identity_pqc_gateway_required: identityGatewayRequired,
    local_sensitive_writes_allowed: localWrites,
    local_fallback_allowed: localFallback,
    state: blockers.length > 0 ? "blocked" : networkOnly ? "nominal" : "degraded",
    blockers,
  };
}

export function assertDataResidencyPolicy(): void {
  const blockers = policyBlockers();
  if (blockers.length > 0) {
    throw new Error(`Data-residency policy blocked startup: ${blockers.join("; ")}`);
  }
}

export function assertProductionSecurityProfile(): void {
  if (env("NODE_ENV").toLowerCase() !== "production") return;

  const blockers = [...policyBlockers()];
  if (!envBool("AUTH_REQUIRED", true)) blockers.push("AUTH_REQUIRED must be true in production");
  if (env("PROXY_HOST") === "0.0.0.0") blockers.push("PROXY_HOST=0.0.0.0 is not allowed in production");
  if (blockers.length > 0) {
    throw new Error(`Production security profile blocked startup: ${blockers.join("; ")}`);
  }
}
