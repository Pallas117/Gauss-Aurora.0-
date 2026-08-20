import { getSupabaseAdminClient } from "../supabase.js";

const MAX_DESIGN_EVIDENCE = 500;
const TABLE_NAME = "ssa_spacecraft_design_evidence";

export interface SpacecraftDesignEvidence {
  noradId?: string;
  systemId?: string;
  observedAt: string;
  source: string;
  shieldingArealDensityGcm2?: number;
  doseLimitKradSi?: number;
  seeQualificationUrl?: string;
  evidenceTypes: string[];
}

const evidenceByTarget = new Map<string, SpacecraftDesignEvidence>();

function targetKey(evidence: Pick<SpacecraftDesignEvidence, "noradId" | "systemId">): string {
  return evidence.noradId ? `norad:${evidence.noradId}` : `system:${evidence.systemId}`;
}

export function validateSpacecraftDesignEvidence(input: unknown):
  | { ok: true; value: SpacecraftDesignEvidence }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "payload must be an object" };
  const body = input as Record<string, unknown>;
  const noradId = typeof body.noradId === "string" ? body.noradId.trim() : undefined;
  const systemId = typeof body.systemId === "string" ? body.systemId.trim().toLowerCase() : undefined;
  if ((!noradId && !systemId) || (noradId && systemId)) return { ok: false, error: "provide exactly one noradId or systemId target" };
  if (noradId && !/^\d{1,8}$/.test(noradId)) return { ok: false, error: "noradId must be a numeric NORAD identifier" };
  if (systemId && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(systemId)) return { ok: false, error: "systemId must be a lowercase stable system identifier" };
  const observedAt = typeof body.observedAt === "string" ? body.observedAt : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!Number.isFinite(Date.parse(observedAt))) return { ok: false, error: "observedAt must be an ISO timestamp" };
  if (!source || source.length > 160) return { ok: false, error: "source is required and must be at most 160 characters" };
  for (const [field, maximum] of [["shieldingArealDensityGcm2", 1000], ["doseLimitKradSi", 1_000_000]] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "number" || !Number.isFinite(body[field]) || body[field] < 0 || body[field] > maximum)) return { ok: false, error: `${field} must be between 0 and ${maximum}` };
  }
  const seeQualificationUrl = body.seeQualificationUrl === undefined ? undefined : typeof body.seeQualificationUrl === "string" ? body.seeQualificationUrl.slice(0, 500) : "";
  if (seeQualificationUrl === "") return { ok: false, error: "seeQualificationUrl must be a string when provided" };
  if (!Array.isArray(body.evidenceTypes) || body.evidenceTypes.length > 20 || body.evidenceTypes.some((value) => typeof value !== "string" || value.length > 80)) return { ok: false, error: "evidenceTypes must be an array of at most 20 short strings" };
  return { ok: true, value: { ...(noradId ? { noradId } : {}), ...(systemId ? { systemId } : {}), observedAt: new Date(Date.parse(observedAt)).toISOString(), source, ...(typeof body.shieldingArealDensityGcm2 === "number" ? { shieldingArealDensityGcm2: body.shieldingArealDensityGcm2 } : {}), ...(typeof body.doseLimitKradSi === "number" ? { doseLimitKradSi: body.doseLimitKradSi } : {}), ...(seeQualificationUrl ? { seeQualificationUrl } : {}), evidenceTypes: (body.evidenceTypes as string[]).map((value) => value.trim()).filter(Boolean) } };
}

export function setSpacecraftDesignEvidence(evidence: SpacecraftDesignEvidence): void {
  const key = targetKey(evidence);
  const existing = evidenceByTarget.get(key);
  if (!existing || Date.parse(evidence.observedAt) >= Date.parse(existing.observedAt)) evidenceByTarget.set(key, evidence);
  while (evidenceByTarget.size > MAX_DESIGN_EVIDENCE) {
    const oldest = [...evidenceByTarget.entries()].sort((a, b) => Date.parse(a[1].observedAt) - Date.parse(b[1].observedAt))[0];
    if (!oldest) break;
    evidenceByTarget.delete(oldest[0]);
  }
}

export function getSpacecraftDesignEvidence(): SpacecraftDesignEvidence[] { return [...evidenceByTarget.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)); }
export function resetSpacecraftDesignEvidence(): void { evidenceByTarget.clear(); }

export function buildPersistedSpacecraftDesignRow(evidence: SpacecraftDesignEvidence): Record<string, unknown> {
  return { norad_id: evidence.noradId ?? null, system_id: evidence.systemId ?? null, observed_at: evidence.observedAt, source: evidence.source, shielding_areal_density_gcm2: evidence.shieldingArealDensityGcm2 ?? null, dose_limit_krad_si: evidence.doseLimitKradSi ?? null, see_qualification_url: evidence.seeQualificationUrl ?? null, evidence_types: evidence.evidenceTypes, updated_at: new Date().toISOString() };
}

export function mapPersistedSpacecraftDesignRow(row: Record<string, unknown>): SpacecraftDesignEvidence | null {
  const input: Record<string, unknown> = { noradId: row.norad_id ?? row.noradId, systemId: row.system_id ?? row.systemId, observedAt: row.observed_at ?? row.observedAt, source: row.source, shieldingArealDensityGcm2: row.shielding_areal_density_gcm2 ?? row.shieldingArealDensityGcm2, doseLimitKradSi: row.dose_limit_krad_si ?? row.doseLimitKradSi, seeQualificationUrl: row.see_qualification_url ?? row.seeQualificationUrl, evidenceTypes: row.evidence_types ?? row.evidenceTypes };
  const parsed = validateSpacecraftDesignEvidence(input);
  return parsed.ok ? parsed.value : null;
}

export async function persistSpacecraftDesignEvidence(evidence: SpacecraftDesignEvidence): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  await supabase.from(TABLE_NAME).upsert(buildPersistedSpacecraftDesignRow(evidence), { onConflict: "observed_at" }).throwOnError();
  return true;
}

export async function hydratePersistedSpacecraftDesignEvidence(force = false): Promise<SpacecraftDesignEvidence[]> {
  if (evidenceByTarget.size > 0 && !force) return getSpacecraftDesignEvidence();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return getSpacecraftDesignEvidence();
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").order("observed_at", { ascending: false }).limit(MAX_DESIGN_EVIDENCE);
    if (error) throw error;
    for (const row of data ?? []) { const evidence = mapPersistedSpacecraftDesignRow(row as Record<string, unknown>); if (evidence) setSpacecraftDesignEvidence(evidence); }
  } catch { /* Keep bounded in-memory evidence when durable storage is unavailable. */ }
  return getSpacecraftDesignEvidence();
}
