import { getSupabaseAdminClient } from "./supabase.js";
import type { DataSource, SourceStatus } from "./types.js";

const KNOWN_SOURCES = new Set<DataSource>([
  "noaa-swpc",
  "esa-hapi",
  "jaxa-erg",
  "mms-cdaweb",
  "mms-lasp",
  "model-nowcast",
]);

function parseDataSource(value: unknown): DataSource | null {
  return typeof value === "string" && KNOWN_SOURCES.has(value as DataSource)
    ? (value as DataSource)
    : null;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseDecision(
  value: unknown,
): "primary" | "validate" | "sample" | "suspend" | null {
  return value === "primary" ||
    value === "validate" ||
    value === "sample" ||
    value === "suspend"
    ? value
    : null;
}

export function mapPersistedSourceHealthRow(row: Record<string, unknown>): SourceStatus | null {
  const source = parseDataSource(row.source);
  if (!source) {
    return null;
  }

  return {
    source,
    lastSeen: parseString(row.last_seen),
    latencySeconds: parseFiniteNumber(row.latency_seconds),
    healthy: row.healthy === true,
    message: parseString(row.message) ?? undefined,
    powerDecision: parseDecision(row.power_decision) ?? undefined,
    utilityScore: parseFiniteNumber(row.utility_score) ?? undefined,
    targetCadenceMs: parseFiniteNumber(row.target_cadence_ms),
    policyReason: parseString(row.policy_reason) ?? undefined,
    observedCostScore: parseFiniteNumber(row.observed_cost_score) ?? undefined,
    avgFetchDurationMs: parseFiniteNumber(row.avg_fetch_duration_ms) ?? undefined,
    avgCpuMs: parseFiniteNumber(row.avg_cpu_ms) ?? undefined,
    avgPayloadKb: parseFiniteNumber(row.avg_payload_kb) ?? undefined,
    sampleCount: parseFiniteNumber(row.sample_count) ?? undefined,
    overrideDecision: parseDecision(row.override_decision),
    overrideTargetCadenceMs: parseFiniteNumber(row.override_target_cadence_ms),
    overrideReason: parseString(row.override_reason),
    overrideUpdatedAt: parseString(row.override_updated_at),
    overrideUpdatedBy: parseString(row.override_updated_by),
  };
}

export function buildPersistedSourceHealthRows(status: SourceStatus[]): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  return status.map((entry) => ({
    source: entry.source,
    last_seen: entry.lastSeen,
    latency_seconds: entry.latencySeconds,
    healthy: entry.healthy,
    message: entry.message ?? null,
    power_decision: entry.powerDecision ?? null,
    utility_score: entry.utilityScore ?? null,
    target_cadence_ms: entry.targetCadenceMs ?? null,
    policy_reason: entry.policyReason ?? null,
    observed_cost_score: entry.observedCostScore ?? null,
    avg_fetch_duration_ms: entry.avgFetchDurationMs ?? null,
    avg_cpu_ms: entry.avgCpuMs ?? null,
    avg_payload_kb: entry.avgPayloadKb ?? null,
    sample_count: entry.sampleCount ?? null,
    override_decision: entry.overrideDecision ?? null,
    override_target_cadence_ms: entry.overrideTargetCadenceMs ?? null,
    override_reason: entry.overrideReason ?? null,
    override_updated_at: entry.overrideUpdatedAt ?? null,
    override_updated_by: entry.overrideUpdatedBy ?? null,
    updated_at: updatedAt,
  }));
}

export async function readPersistedSourceHealth(): Promise<SourceStatus[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase.from("source_health").select("*").order("source");
  if (error) {
    throw error;
  }
  return (data ?? [])
    .map((row) => mapPersistedSourceHealthRow(row as Record<string, unknown>))
    .filter((row): row is SourceStatus => row != null);
}
