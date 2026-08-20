import { getSupabaseAdminClient } from "../supabase.js";

export type HealthTelemetryStatus = "nominal" | "degraded" | "critical" | "unknown";
export type DamageEvidenceStatus = "none" | "suspected" | "confirmed" | "unknown";

const MAX_HEALTH_EVIDENCE = 500;
const TABLE_NAME = "ssa_spacecraft_health_evidence";

export interface SpacecraftHealthEvidence {
  noradId: string;
  observedAt: string;
  source: string;
  telemetryStatus: HealthTelemetryStatus;
  damageStatus: DamageEvidenceStatus;
  evidenceTypes: string[];
  provenanceUrl?: string;
  notes?: string;
}

const evidenceByNorad = new Map<string, SpacecraftHealthEvidence>();

export function validateSpacecraftHealthEvidence(input: unknown):
  | { ok: true; value: SpacecraftHealthEvidence }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "payload must be an object" };
  const body = input as Record<string, unknown>;
  const noradId = typeof body.noradId === "string" ? body.noradId.trim() : "";
  const observedAt = typeof body.observedAt === "string" ? body.observedAt : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!/^\d{1,8}$/.test(noradId)) return { ok: false, error: "noradId must be a numeric NORAD identifier" };
  if (!Number.isFinite(Date.parse(observedAt))) return { ok: false, error: "observedAt must be an ISO timestamp" };
  if (!source || source.length > 160) return { ok: false, error: "source is required and must be at most 160 characters" };
  if (!(body.telemetryStatus === "nominal" || body.telemetryStatus === "degraded" || body.telemetryStatus === "critical" || body.telemetryStatus === "unknown")) return { ok: false, error: "invalid telemetryStatus" };
  if (!(body.damageStatus === "none" || body.damageStatus === "suspected" || body.damageStatus === "confirmed" || body.damageStatus === "unknown")) return { ok: false, error: "invalid damageStatus" };
  if (!Array.isArray(body.evidenceTypes) || body.evidenceTypes.length > 20 || body.evidenceTypes.some((value) => typeof value !== "string" || value.length > 80)) return { ok: false, error: "evidenceTypes must be an array of at most 20 short strings" };
  const provenanceUrl = body.provenanceUrl === undefined ? undefined : typeof body.provenanceUrl === "string" ? body.provenanceUrl.slice(0, 500) : "";
  if (provenanceUrl === "") return { ok: false, error: "provenanceUrl must be a string when provided" };
  const notes = body.notes === undefined ? undefined : typeof body.notes === "string" ? body.notes.slice(0, 500) : "";
  if (notes === "") return { ok: false, error: "notes must be a string when provided" };
  return {
    ok: true,
    value: {
      noradId,
      observedAt: new Date(Date.parse(observedAt)).toISOString(),
      source,
      telemetryStatus: body.telemetryStatus,
      damageStatus: body.damageStatus,
      evidenceTypes: (body.evidenceTypes as string[]).map((value) => value.trim()).filter(Boolean),
      ...(provenanceUrl ? { provenanceUrl } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

export function setSpacecraftHealthEvidence(evidence: SpacecraftHealthEvidence): void {
  const existing = evidenceByNorad.get(evidence.noradId);
  if (!existing || Date.parse(evidence.observedAt) >= Date.parse(existing.observedAt)) evidenceByNorad.set(evidence.noradId, evidence);
  while (evidenceByNorad.size > MAX_HEALTH_EVIDENCE) {
    const oldest = [...evidenceByNorad.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0];
    if (!oldest) break;
    evidenceByNorad.delete(oldest.noradId);
  }
}

export function getSpacecraftHealthEvidence(): SpacecraftHealthEvidence[] {
  return [...evidenceByNorad.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export function getLatestSpacecraftHealthEvidence(noradId: string, maxAgeMs = 60 * 60 * 1000, nowMs = Date.now()): SpacecraftHealthEvidence | null {
  const evidence = evidenceByNorad.get(noradId);
  if (!evidence) return null;
  const age = nowMs - Date.parse(evidence.observedAt);
  return age >= 0 && age <= maxAgeMs ? evidence : null;
}

export function resetSpacecraftHealthEvidence(): void { evidenceByNorad.clear(); }

export function buildPersistedSpacecraftHealthRow(evidence: SpacecraftHealthEvidence): Record<string, unknown> {
  return { norad_id: evidence.noradId, observed_at: evidence.observedAt, source: evidence.source, telemetry_status: evidence.telemetryStatus, damage_status: evidence.damageStatus, evidence_types: evidence.evidenceTypes, provenance_url: evidence.provenanceUrl ?? null, notes: evidence.notes ?? null, updated_at: new Date().toISOString() };
}

export function mapPersistedSpacecraftHealthRow(row: Record<string, unknown>): SpacecraftHealthEvidence | null {
  const input: Record<string, unknown> = { noradId: row.norad_id ?? row.noradId, observedAt: row.observed_at ?? row.observedAt, source: row.source, telemetryStatus: row.telemetry_status ?? row.telemetryStatus, damageStatus: row.damage_status ?? row.damageStatus, evidenceTypes: row.evidence_types ?? row.evidenceTypes };
  if (typeof row.provenance_url === "string") input.provenanceUrl = row.provenance_url;
  if (typeof row.notes === "string") input.notes = row.notes;
  const parsed = validateSpacecraftHealthEvidence(input);
  return parsed.ok ? parsed.value : null;
}

export async function persistSpacecraftHealthEvidence(evidence: SpacecraftHealthEvidence): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  await supabase.from(TABLE_NAME).upsert(buildPersistedSpacecraftHealthRow(evidence), { onConflict: "norad_id,observed_at" }).throwOnError();
  return true;
}

export async function hydratePersistedSpacecraftHealthEvidence(force = false): Promise<SpacecraftHealthEvidence[]> {
  if (evidenceByNorad.size > 0 && !force) return getSpacecraftHealthEvidence();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return getSpacecraftHealthEvidence();
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").order("observed_at", { ascending: false }).limit(MAX_HEALTH_EVIDENCE);
    if (error) throw error;
    for (const row of data ?? []) {
      const evidence = mapPersistedSpacecraftHealthRow(row as Record<string, unknown>);
      if (evidence) setSpacecraftHealthEvidence(evidence);
    }
  } catch {
    // Keep bounded in-memory evidence when durable storage is unavailable.
  }
  return getSpacecraftHealthEvidence();
}
