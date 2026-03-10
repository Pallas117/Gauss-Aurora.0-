import { getSupabaseAdminClient } from "../supabase.js";
import type { ConjunctionRecord } from "./conjunction-interop.js";
import { getConjunctionEvents, setConjunctionRecords } from "./space-domain-store.js";

const TABLE_NAME = "ssa_conjunction_events";

let conjunctionHydrationPromise: Promise<ConjunctionRecord[]> | null = null;

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseDescriptor(value: unknown): { name: string | null; objectId: string | null } {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    name: parseString(row.name),
    objectId: parseString(row.object_id ?? row.objectId),
  };
}

export function mapPersistedConjunctionRow(row: Record<string, unknown>): ConjunctionRecord | null {
  const id = parseString(row.id);
  const ingestedAt = parseString(row.ingested_at ?? row.ingestedAt);
  const format = parseString(row.format) as ConjunctionRecord["format"] | null;
  const purpose = parseString(row.purpose) as ConjunctionRecord["purpose"] | null;
  if (!id || !ingestedAt || !format || !purpose) {
    return null;
  }

  return {
    id,
    ingestedAt,
    format,
    purpose,
    source: parseString(row.source),
    tca: parseString(row.tca),
    missDistanceM: parseNumber(row.miss_distance_m ?? row.missDistanceM),
    relativeSpeedMS: parseNumber(row.relative_speed_m_s ?? row.relativeSpeedMS),
    probabilityOfCollision: parseNumber(
      row.probability_of_collision ?? row.probabilityOfCollision,
    ),
    primary: parseDescriptor(row.primary_object ?? row.primary),
    secondary: parseDescriptor(row.secondary_object ?? row.secondary),
    warnings: parseStringArray(row.warnings),
    rawExcerpt: parseString(row.raw_excerpt ?? row.rawExcerpt) ?? "{}",
  };
}

export function buildPersistedConjunctionRow(record: ConjunctionRecord): Record<string, unknown> {
  return {
    id: record.id,
    ingested_at: record.ingestedAt,
    format: record.format,
    purpose: record.purpose,
    source: record.source,
    tca: record.tca,
    miss_distance_m: record.missDistanceM,
    relative_speed_m_s: record.relativeSpeedMS,
    probability_of_collision: record.probabilityOfCollision,
    primary_object: {
      name: record.primary.name,
      object_id: record.primary.objectId,
    },
    secondary_object: {
      name: record.secondary.name,
      object_id: record.secondary.objectId,
    },
    warnings: record.warnings,
    raw_excerpt: record.rawExcerpt,
    updated_at: new Date().toISOString(),
  };
}

export async function persistConjunctionRecord(record: ConjunctionRecord): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return false;
  }

  await supabase.from(TABLE_NAME).upsert(buildPersistedConjunctionRow(record)).throwOnError();
  return true;
}

export async function readPersistedConjunctionRecords(limit = 200): Promise<ConjunctionRecord[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .order("ingested_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => mapPersistedConjunctionRow(row as Record<string, unknown>))
    .filter((row): row is ConjunctionRecord => row != null)
    .reverse();
}

export async function hydratePersistedConjunctionState(force = false): Promise<ConjunctionRecord[]> {
  if (conjunctionHydrationPromise && !force) {
    return conjunctionHydrationPromise;
  }

  if (getConjunctionEvents(1).length > 0 && !force) {
    return getConjunctionEvents(200).reverse();
  }

  conjunctionHydrationPromise = (async () => {
    try {
      const records = await readPersistedConjunctionRecords(200);
      if (records.length > 0) {
        setConjunctionRecords(records);
      }
      return records;
    } catch {
      return getConjunctionEvents(200).reverse();
    }
  })();

  return conjunctionHydrationPromise;
}
