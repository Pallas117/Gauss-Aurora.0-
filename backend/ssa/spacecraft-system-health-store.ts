import { getSupabaseAdminClient } from "../supabase.js";
import type { DamageEvidenceStatus, HealthTelemetryStatus } from "./spacecraft-health-store.js";

const MAX_SYSTEM_HEALTH_EVIDENCE = 500;
const TABLE_NAME = "ssa_spacecraft_system_health_evidence";

export interface SpacecraftSystemHealthEvidence {
  systemId: string;
  observedAt: string;
  source: string;
  telemetryStatus: HealthTelemetryStatus;
  damageStatus: DamageEvidenceStatus;
  evidenceTypes: string[];
  provenanceUrl?: string;
  notes?: string;
}

const evidenceBySystem = new Map<string, SpacecraftSystemHealthEvidence>();

export function validateSpacecraftSystemHealthEvidence(input: unknown):
  | { ok: true; value: SpacecraftSystemHealthEvidence }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "payload must be an object" };
  const body = input as Record<string, unknown>;
  const systemId = typeof body.systemId === "string" ? body.systemId.trim().toLowerCase() : "";
  const observedAt = typeof body.observedAt === "string" ? body.observedAt : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(systemId)) return { ok: false, error: "systemId must be a lowercase stable system identifier" };
  if (!Number.isFinite(Date.parse(observedAt))) return { ok: false, error: "observedAt must be an ISO timestamp" };
  if (!source || source.length > 160) return { ok: false, error: "source is required and must be at most 160 characters" };
  if (!(body.telemetryStatus === "nominal" || body.telemetryStatus === "degraded" || body.telemetryStatus === "critical" || body.telemetryStatus === "unknown")) return { ok: false, error: "invalid telemetryStatus" };
  if (!(body.damageStatus === "none" || body.damageStatus === "suspected" || body.damageStatus === "confirmed" || body.damageStatus === "unknown")) return { ok: false, error: "invalid damageStatus" };
  if (!Array.isArray(body.evidenceTypes) || body.evidenceTypes.length > 20 || body.evidenceTypes.some((value) => typeof value !== "string" || value.length > 80)) return { ok: false, error: "evidenceTypes must be an array of at most 20 short strings" };
  const provenanceUrl = body.provenanceUrl === undefined ? undefined : typeof body.provenanceUrl === "string" ? body.provenanceUrl.slice(0, 500) : "";
  if (provenanceUrl === "") return { ok: false, error: "provenanceUrl must be a string when provided" };
  const notes = body.notes === undefined ? undefined : typeof body.notes === "string" ? body.notes.slice(0, 500) : "";
  if (notes === "") return { ok: false, error: "notes must be a string when provided" };
  return { ok: true, value: { systemId, observedAt: new Date(Date.parse(observedAt)).toISOString(), source, telemetryStatus: body.telemetryStatus, damageStatus: body.damageStatus, evidenceTypes: (body.evidenceTypes as string[]).map((value) => value.trim()).filter(Boolean), ...(provenanceUrl ? { provenanceUrl } : {}), ...(notes ? { notes } : {}) } };
}

export function setSpacecraftSystemHealthEvidence(evidence: SpacecraftSystemHealthEvidence): void {
  const existing = evidenceBySystem.get(evidence.systemId);
  if (!existing || Date.parse(evidence.observedAt) >= Date.parse(existing.observedAt)) evidenceBySystem.set(evidence.systemId, evidence);
  while (evidenceBySystem.size > MAX_SYSTEM_HEALTH_EVIDENCE) {
    const oldest = [...evidenceBySystem.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0];
    if (!oldest) break;
    evidenceBySystem.delete(oldest.systemId);
  }
}

export function getSpacecraftSystemHealthEvidence(): SpacecraftSystemHealthEvidence[] {
  return [...evidenceBySystem.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export function getLatestSpacecraftSystemHealthEvidence(systemId: string, maxAgeMs = 60 * 60 * 1000, nowMs = Date.now()): SpacecraftSystemHealthEvidence | null {
  const evidence = evidenceBySystem.get(systemId);
  if (!evidence) return null;
  const age = nowMs - Date.parse(evidence.observedAt);
  return age >= 0 && age <= maxAgeMs ? evidence : null;
}

export function resetSpacecraftSystemHealthEvidence(): void { evidenceBySystem.clear(); }

export function buildPersistedSpacecraftSystemHealthRow(evidence: SpacecraftSystemHealthEvidence): Record<string, unknown> {
  return { system_id: evidence.systemId, observed_at: evidence.observedAt, source: evidence.source, telemetry_status: evidence.telemetryStatus, damage_status: evidence.damageStatus, evidence_types: evidence.evidenceTypes, provenance_url: evidence.provenanceUrl ?? null, notes: evidence.notes ?? null, updated_at: new Date().toISOString() };
}

export function mapPersistedSpacecraftSystemHealthRow(row: Record<string, unknown>): SpacecraftSystemHealthEvidence | null {
  const input: Record<string, unknown> = { systemId: row.system_id ?? row.systemId, observedAt: row.observed_at ?? row.observedAt, source: row.source, telemetryStatus: row.telemetry_status ?? row.telemetryStatus, damageStatus: row.damage_status ?? row.damageStatus, evidenceTypes: row.evidence_types ?? row.evidenceTypes };
  if (typeof row.provenance_url === "string") input.provenanceUrl = row.provenance_url;
  if (typeof row.notes === "string") input.notes = row.notes;
  const parsed = validateSpacecraftSystemHealthEvidence(input);
  return parsed.ok ? parsed.value : null;
}

export async function persistSpacecraftSystemHealthEvidence(evidence: SpacecraftSystemHealthEvidence): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  await supabase.from(TABLE_NAME).upsert(buildPersistedSpacecraftSystemHealthRow(evidence), { onConflict: "system_id,observed_at" }).throwOnError();
  return true;
}

export async function hydratePersistedSpacecraftSystemHealthEvidence(force = false): Promise<SpacecraftSystemHealthEvidence[]> {
  if (evidenceBySystem.size > 0 && !force) return getSpacecraftSystemHealthEvidence();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return getSpacecraftSystemHealthEvidence();
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").order("observed_at", { ascending: false }).limit(MAX_SYSTEM_HEALTH_EVIDENCE);
    if (error) throw error;
    for (const row of data ?? []) {
      const evidence = mapPersistedSpacecraftSystemHealthRow(row as Record<string, unknown>);
      if (evidence) setSpacecraftSystemHealthEvidence(evidence);
    }
  } catch {
    // Keep bounded in-memory evidence when durable storage is unavailable.
  }
  return getSpacecraftSystemHealthEvidence();
}
