import type { SourceStatus } from "@/lib/types/space-weather";

type TruthFields = Pick<SourceStatus, "healthy" | "truthState">;

/**
 * True for reachability probes (e.g. jaxa-erg) that never produce measurements.
 * They are neither healthy nor degraded, so health rollups leave them out.
 */
export function isUnknownTruthSource(source: Pick<SourceStatus, "truthState">): boolean {
  return source.truthState === "unknown";
}

/** Measuring sources only; unknown-truth probes are excluded. */
export function measuringSources<T extends Pick<SourceStatus, "truthState">>(sources: T[]): T[] {
  return sources.filter((source) => !isUnknownTruthSource(source));
}

/** A measuring source that is not healthy. */
export function isDegradedSource(source: TruthFields): boolean {
  return !source.healthy && !isUnknownTruthSource(source);
}

export function sourceHealthLabel(source: TruthFields): "healthy" | "degraded" | "unknown" {
  if (isUnknownTruthSource(source)) return "unknown";
  return source.healthy ? "healthy" : "degraded";
}

export function sourceHealthVariant(source: TruthFields): "secondary" | "destructive" | "outline" {
  if (isUnknownTruthSource(source)) return "outline";
  return source.healthy ? "secondary" : "destructive";
}

export type SourceHealth = "healthy" | "degraded" | "unknown";

export interface SourceRollup {
  /** "unknown" when no measuring source is present: nothing measured, so nothing is nominal. */
  state: SourceHealth;
  measuring: number;
  healthy: number;
  degraded: number;
  /** Unknown-truth probes, left out of every count above. */
  probes: number;
}

/** Health summary over measuring sources only (GAU-81). */
export function rollupSources(sources: TruthFields[]): SourceRollup {
  const measuring = measuringSources(sources);
  const healthy = measuring.filter((source) => source.healthy).length;
  const degraded = measuring.length - healthy;
  return {
    state: measuring.length === 0 ? "unknown" : degraded > 0 ? "degraded" : "healthy",
    measuring: measuring.length,
    healthy,
    degraded,
    probes: sources.length - measuring.length,
  };
}
