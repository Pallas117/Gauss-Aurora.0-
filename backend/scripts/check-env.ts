type EnvRequirement = {
  key: string;
  required: boolean;
  description: string;
};

const requirements: EnvRequirement[] = [
  { key: "SUPABASE_URL", required: true, description: "Supabase project URL" },
  { key: "SUPABASE_ANON_KEY", required: true, description: "Supabase anon/public key" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: true, description: "Supabase service role key" },
  { key: "PROXY_PORT", required: false, description: "Backend HTTP port (default 3001)" },
  { key: "PROXY_HOST", required: false, description: "Backend bind host (default 0.0.0.0 in dev, loopback when private origins disabled)" },
  { key: "FRONTEND_HOST", required: false, description: "Frontend dev bind host (e.g. 0.0.0.0 for hotspot/LAN)" },
  { key: "ALLOWED_ORIGINS", required: false, description: "CSV list for CORS allowlist" },
  { key: "ALLOW_PRIVATE_NETWORK_ORIGINS", required: false, description: "Allow hotspot/LAN origins on known dev ports" },
  { key: "AUTH_REQUIRED", required: false, description: "Set false only for local bypass" },
  { key: "CYBERTIGER_ENABLED", required: false, description: "Enable/disable CyberTiger daemon" },
  { key: "CYBERTIGER_RATE_LIMIT_WINDOW_MS", required: false, description: "Rate limit window in ms" },
  { key: "CYBERTIGER_RATE_LIMIT_MAX", required: false, description: "Max requests per IP per window" },
  { key: "CYBERTIGER_AUTH_FAILURE_WINDOW_MS", required: false, description: "Auth failure rolling window in ms" },
  { key: "CYBERTIGER_AUTH_FAILURE_THRESHOLD", required: false, description: "Auth failures before auto-block" },
  { key: "CYBERTIGER_AUTO_BLOCK_SECONDS", required: false, description: "Auto-block duration in seconds" },
  { key: "CYBERTIGER_MAX_EVENTS", required: false, description: "In-memory security event cap" },
  { key: "LOCAL_INFER_URL", required: false, description: "ML inference service URL" },
  { key: "GAUSS_PREINFERENCE_GATE_ENABLED", required: false, description: "Enable lightweight gate before remote inference" },
  { key: "GAUSS_PREINFERENCE_GATE_LOG", required: false, description: "Enable verbose gate decision logs" },
  { key: "GAUSS_GATE_FLUX_THRESHOLD", required: false, description: "Flux threshold used by pre-inference gate" },
  { key: "GAUSS_GATE_SAFETY_MARGIN", required: false, description: "Safety margin applied to gate threshold" },
  { key: "GAUSS_GATE_SIGMA", required: false, description: "Normal-CDF sigma for gate confidence curve" },
  { key: "GAUSS_GATE_THREAT_TRIGGER_SCORE", required: false, description: "Composite threat score required to force inference" },
  { key: "TRAINING_SCRIPT_PATH", required: false, description: "Model training script path" },
  { key: "FRONTEND_BASE_URL", required: false, description: "Frontend URL for full-stack mission harness" },
  { key: "GAUSS_BRAIN_URL", required: false, description: "Local Gauss Brain endpoint (default http://127.0.0.1:8089/v1)" },
  { key: "GAUSS_RAG_URL", required: false, description: "Optional RAG service endpoint for mission validation" },
  { key: "FULLSTACK_WRITE_MODE", required: false, description: "Full-stack write mode (default controlled)" },
  { key: "FULLSTACK_CLEANUP", required: false, description: "Delete full-stack test records after validation" },
];

function maskSecret(value: string): string {
  if (value.length <= 10) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

let hasMissingRequired = false;

console.log("[backend-env] Checking backend configuration:");
for (const item of requirements) {
  const raw = process.env[item.key];
  const present = typeof raw === "string" && raw.trim().length > 0;
  const marker = present ? "OK " : item.required ? "ERR" : "WARN";

  let valuePreview = "<missing>";
  if (present) {
    const value = raw!.trim();
    const looksSecret =
      item.key.includes("KEY") || item.key.includes("TOKEN") || item.key.includes("SECRET");
    valuePreview = looksSecret ? maskSecret(value) : value;
  }

  console.log(`${marker} ${item.key}=${valuePreview}  (${item.description})`);

  if (item.required && !present) {
    hasMissingRequired = true;
  }
}

if (hasMissingRequired) {
  console.error("[backend-env] Missing required vars. See .env.example and your local .env.");
  process.exit(1);
}

console.log("[backend-env] Ready.");
