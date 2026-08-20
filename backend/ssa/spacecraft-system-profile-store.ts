import { getSupabaseAdminClient } from "../supabase.js";

const MAX_PROFILES = 500;
const TABLE_NAME = "ssa_spacecraft_system_profiles";

export interface SpacecraftSystemProfile {
  systemId: string;
  aliases: string[];
  namePatterns: string[];
  missionType: string;
  operator?: string;
  source: string;
  observedAt: string;
  expectedNoradIds?: string[];
  expectedObjectCount?: number;
}

const profilesBySystem = new Map<string, SpacecraftSystemProfile>();

export function validateSpacecraftSystemProfile(input: unknown):
  | { ok: true; value: SpacecraftSystemProfile }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "payload must be an object" };
  const body = input as Record<string, unknown>;
  const systemId = typeof body.systemId === "string" ? body.systemId.trim().toLowerCase() : "";
  const missionType = typeof body.missionType === "string" ? body.missionType.trim() : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const observedAt = typeof body.observedAt === "string" ? body.observedAt : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(systemId)) return { ok: false, error: "systemId must be a lowercase stable system identifier" };
  if (!missionType || missionType.length > 80) return { ok: false, error: "missionType is required and must be at most 80 characters" };
  if (!source || source.length > 160) return { ok: false, error: "source is required and must be at most 160 characters" };
  if (!Number.isFinite(Date.parse(observedAt))) return { ok: false, error: "observedAt must be an ISO timestamp" };
  const list = (value: unknown, name: string) => Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 120) ? { ok: true as const, value: value.map((item) => item.trim()) } : { ok: false as const, error: `${name} must be an array of at most 50 short strings` };
  const aliases = list(body.aliases, "aliases");
  const namePatterns = list(body.namePatterns, "namePatterns");
  if (!aliases.ok) return aliases;
  if (!namePatterns.ok) return namePatterns;
  const expectedNoradIds = body.expectedNoradIds === undefined ? undefined : Array.isArray(body.expectedNoradIds) && body.expectedNoradIds.length <= 500 && body.expectedNoradIds.every((id) => typeof id === "string" && /^\d{1,8}$/.test(id.trim())) ? [...new Set(body.expectedNoradIds.map((id) => id.trim()))] : null;
  if (expectedNoradIds === null) return { ok: false, error: "expectedNoradIds must contain numeric NORAD identifiers" };
  if (body.expectedObjectCount !== undefined && (typeof body.expectedObjectCount !== "number" || !Number.isInteger(body.expectedObjectCount) || body.expectedObjectCount < 0 || body.expectedObjectCount > 500)) return { ok: false, error: "expectedObjectCount must be an integer between 0 and 500" };
  if (expectedNoradIds && body.expectedObjectCount !== undefined && body.expectedObjectCount < expectedNoradIds.length) return { ok: false, error: "expectedObjectCount cannot be smaller than expectedNoradIds" };
  return { ok: true, value: { systemId, aliases: aliases.value, namePatterns: namePatterns.value, missionType, ...(typeof body.operator === "string" && body.operator.trim() ? { operator: body.operator.trim().slice(0, 160) } : {}), source, observedAt: new Date(Date.parse(observedAt)).toISOString(), ...(expectedNoradIds ? { expectedNoradIds } : {}), ...(typeof body.expectedObjectCount === "number" ? { expectedObjectCount: body.expectedObjectCount } : {}) } };
}

export function setSpacecraftSystemProfile(profile: SpacecraftSystemProfile): void {
  const existing = profilesBySystem.get(profile.systemId);
  if (!existing || Date.parse(profile.observedAt) >= Date.parse(existing.observedAt)) profilesBySystem.set(profile.systemId, profile);
  while (profilesBySystem.size > MAX_PROFILES) { const oldest = [...profilesBySystem.entries()].sort((a, b) => Date.parse(a[1].observedAt) - Date.parse(b[1].observedAt))[0]; if (!oldest) break; profilesBySystem.delete(oldest[0]); }
}
export function getSpacecraftSystemProfiles(): SpacecraftSystemProfile[] { return [...profilesBySystem.values()].sort((a, b) => a.systemId.localeCompare(b.systemId)); }
export function resetSpacecraftSystemProfiles(): void { profilesBySystem.clear(); }
export function buildPersistedSpacecraftSystemProfileRow(profile: SpacecraftSystemProfile): Record<string, unknown> { return { system_id: profile.systemId, aliases: profile.aliases, name_patterns: profile.namePatterns, mission_type: profile.missionType, operator: profile.operator ?? null, source: profile.source, observed_at: profile.observedAt, expected_norad_ids: profile.expectedNoradIds ?? null, expected_object_count: profile.expectedObjectCount ?? null, updated_at: new Date().toISOString() }; }
export function mapPersistedSpacecraftSystemProfileRow(row: Record<string, unknown>): SpacecraftSystemProfile | null { const parsed = validateSpacecraftSystemProfile({ systemId: row.system_id ?? row.systemId, aliases: row.aliases, namePatterns: row.name_patterns ?? row.namePatterns, missionType: row.mission_type ?? row.missionType, operator: row.operator, source: row.source, observedAt: row.observed_at ?? row.observedAt, expectedNoradIds: row.expected_norad_ids ?? row.expectedNoradIds, expectedObjectCount: row.expected_object_count ?? row.expectedObjectCount }); return parsed.ok ? parsed.value : null; }
export async function persistSpacecraftSystemProfile(profile: SpacecraftSystemProfile): Promise<boolean> { const supabase = getSupabaseAdminClient(); if (!supabase) return false; await supabase.from(TABLE_NAME).upsert(buildPersistedSpacecraftSystemProfileRow(profile), { onConflict: "system_id" }).throwOnError(); return true; }
export async function hydratePersistedSpacecraftSystemProfiles(force = false): Promise<SpacecraftSystemProfile[]> { if (profilesBySystem.size > 0 && !force) return getSpacecraftSystemProfiles(); const supabase = getSupabaseAdminClient(); if (!supabase) return getSpacecraftSystemProfiles(); try { const { data, error } = await supabase.from(TABLE_NAME).select("*").order("observed_at", { ascending: false }).limit(MAX_PROFILES); if (error) throw error; for (const row of data ?? []) { const profile = mapPersistedSpacecraftSystemProfileRow(row as Record<string, unknown>); if (profile) setSpacecraftSystemProfile(profile); } } catch { /* Keep bounded in-memory profiles when durable storage is unavailable. */ } return getSpacecraftSystemProfiles(); }
