export type MeshTransport = "tailscale" | "direct" | "dtn";

function envBool(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(value);
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt((process.env[name] ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getMeshValidators(): string[] {
  return Array.from(
    new Set(
      (process.env.GAUSS_MESH_VALIDATORS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function getMeshTransport(): MeshTransport {
  const value = (process.env.GAUSS_MESH_TRANSPORT ?? "tailscale").trim().toLowerCase();
  if (value === "direct" || value === "dtn") return value;
  return "tailscale";
}

export function getMeshPolicyErrors(): string[] {
  if (!envBool("GAUSS_MESH_ENABLED", false)) return [];
  const nodeId = (process.env.GAUSS_MESH_NODE_ID ?? "").trim();
  const validators = getMeshValidators();
  const errors: string[] = [];
  if (!nodeId) errors.push("GAUSS_MESH_NODE_ID is required when mesh is enabled");
  if (validators.length < 3) errors.push("GAUSS_MESH_VALIDATORS must contain at least three validators");
  if (nodeId && validators.length > 0 && !validators.includes(nodeId)) {
    errors.push("GAUSS_MESH_NODE_ID must be present in GAUSS_MESH_VALIDATORS");
  }
  return errors;
}

export function assertMeshPolicy(): void {
  const errors = getMeshPolicyErrors();
  if (errors.length > 0) {
    throw new Error(`Mesh policy rejected startup: ${errors.join("; ")}`);
  }
}

export function getMeshStatus() {
  const validators = getMeshValidators();
  const enabled = envBool("GAUSS_MESH_ENABLED", false);
  return {
    enabled,
    protocol: "gauss-mesh-v1",
    node_id: (process.env.GAUSS_MESH_NODE_ID ?? "").trim() || null,
    validator_count: validators.length,
    quorum: validators.length >= 3 ? Math.floor((validators.length * 2) / 3) + 1 : null,
    transport: getMeshTransport(),
    max_events_per_block: boundedInt("GAUSS_MESH_MAX_EVENTS_PER_BLOCK", 256, 1, 256),
    cloud_anchor_enabled: envBool("GAUSS_MESH_CLOUD_ANCHOR_ENABLED", false),
    payloads_on_ledger: false,
    command_authority: false,
    policy_valid: getMeshPolicyErrors().length === 0,
    errors: getMeshPolicyErrors(),
  } as const;
}
