import type { SpaceDomainAnalysis, SpaceDomainSummary } from "@/lib/types/space-weather";

/**
 * Which risk inputs are measured right now. An unavailable feed is unknown,
 * so it must never read as "0%" or "quiet" (GAU-81, GAU-63).
 */
export function riskInputs(summary: SpaceDomainSummary): { catalog: boolean; conjunctions: boolean } {
  return {
    catalog: summary.availability.riskZones,
    conjunctions: summary.availability.conjunctions,
  };
}

function determineFallbackSeverity(summary: SpaceDomainSummary): SpaceDomainAnalysis["severity"] {
  const known = riskInputs(summary);
  if (!known.catalog && !known.conjunctions) {
    return "unknown";
  }
  const collision = summary.conjunctionRisk.maxCollisionProbability ?? 0;
  if (known.conjunctions && (summary.conjunctionRisk.recentCriticalCount > 0 || collision >= 0.01)) {
    return "critical";
  }
  if (summary.learnedLane.trigger || (known.conjunctions && collision >= 0.005)) {
    return "warning";
  }
  if (summary.learnedLane.score >= 0.45 || (known.catalog && summary.crowding.maxRiskScore >= 0.55)) {
    return "watch";
  }
  // Nothing elevated in what is measured; with an input missing that is not "quiet".
  return known.catalog && known.conjunctions ? "quiet" : "unknown";
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatMeters(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value).toLocaleString()} m`;
}

function missingFeeds(known: { catalog: boolean; conjunctions: boolean }): string {
  const missing = [!known.catalog && "risk-zone", !known.conjunctions && "conjunction"].filter(Boolean);
  return missing.length === 2 ? "Risk-zone and conjunction feeds are" : `The ${missing[0]} feed is`;
}

/** The public SDA analysis built on the client, labelling every unmeasured input as unknown. */
export function buildDeterministicPublicAnalysis(
  summary: SpaceDomainSummary,
  analysis: SpaceDomainAnalysis | null,
  availabilityMode: "live" | "projected" | "warming" = "live",
): SpaceDomainAnalysis {
  const known = riskInputs(summary);
  const complete = known.catalog && known.conjunctions;
  const reported = analysis?.severity ?? determineFallbackSeverity(summary);
  // A "quiet" verdict needs every input measured.
  const severity = reported === "quiet" && !complete ? "unknown" : reported;
  const metrics = analysis?.metrics ?? {
    learnedLaneScore: summary.learnedLane.score,
    maxRiskScore: summary.crowding.maxRiskScore,
    maxCollisionProbability: summary.conjunctionRisk.maxCollisionProbability,
    minMissDistanceM: summary.conjunctionRisk.minMissDistanceM,
    conjunctionCount: summary.counts.conjunctionCount,
  };
  const catalogRisk = known.catalog
    ? `catalog risk ${formatPercent(metrics.maxRiskScore)}`
    : "catalog risk unknown (no current risk-zone data)";
  const conjunctions = known.conjunctions
    ? `${metrics.conjunctionCount} conjunctions under watch`
    : "conjunction data unavailable";

  const headline =
    availabilityMode === "projected"
      ? "Projected orbital lane active"
      : availabilityMode === "warming"
        ? "Public orbital lane awaiting ingest"
        : severity === "unknown"
          ? "Orbital risk unknown"
          : severity === "critical"
            ? "Critical conjunction activity detected"
            : severity === "warning"
              ? "Elevated orbital risk requires attention"
              : severity === "watch"
                ? "Orbital watch active across the public lane"
                : "Public orbital lane remains stable";

  const summaryText =
    availabilityMode === "projected"
      ? "Live SSA ingest is stale, so Gauss is serving a clearly labeled projected hold-state from the last trusted orbital snapshot."
      : availabilityMode === "warming"
        ? "Catalog and risk-zone feeds are still warming up. Public SDA remains online while ingest catches up."
        : severity === "unknown"
          ? `${missingFeeds(known)} unavailable, so orbital risk is unknown, not low.`
          : severity === "critical"
            ? `Critical conjunction lane active with ${metrics.conjunctionCount} tracked events, peak collision probability ${formatPercent(metrics.maxCollisionProbability)}, and minimum miss distance ${formatMeters(metrics.minMissDistanceM)}.`
            : severity === "warning"
              ? `Elevated SSA pressure detected: learned lane ${formatPercent(metrics.learnedLaneScore)}, ${catalogRisk}, and ${conjunctions}.`
              : severity === "watch"
                ? `Crowding and learned-lane drift are above quiet baseline: ${catalogRisk}, learned SSA score ${formatPercent(metrics.learnedLaneScore)}.`
                : `No elevated conjunction trigger is active. Catalog risk is ${formatPercent(metrics.maxRiskScore)} and the learned SSA lane remains below the warning threshold.`;

  return {
    generatedAt: analysis?.generatedAt ?? summary.updatedAt ?? new Date().toISOString(),
    cadenceSeconds: analysis?.cadenceSeconds ?? 30,
    source: "deterministic",
    severity,
    headline,
    summary: summaryText,
    confidence: analysis?.confidence ?? summary.learnedLane.confidence,
    changed: analysis?.changed ?? false,
    changedSignals: analysis?.changedSignals ?? [],
    metrics,
    model: {
      used: false,
      modelId: null,
      generatedAt: null,
    },
  };
}
