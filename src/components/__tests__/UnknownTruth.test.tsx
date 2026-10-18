import { render, screen } from "@testing-library/react";
import { OperatorTimeline } from "@/components/cockpit/OperatorTimeline";
import { rollupSources } from "@/lib/source-truth";
import { buildDeterministicPublicAnalysis } from "@/lib/ssa-public-analysis";
import type { SourceStatus, SpaceDomainAnalysis, SpaceDomainSummary } from "@/lib/types/space-weather";

// GAU-81: unknown risk and unknown-truth probes must never read as "0%", "healthy" or "nominal".

function source(name: string, healthy: boolean, truthState?: "observed" | "unknown"): SourceStatus {
  return { source: name, lastSeen: null, latencySeconds: null, healthy, ...(truthState ? { truthState } : {}) };
}

const JAXA_PROBE = source("jaxa-erg", false, "unknown");

function summary(availability: { riskZones: boolean; conjunctions: boolean }, maxRiskScore = 0): SpaceDomainSummary {
  return {
    updatedAt: "2026-10-18T00:00:00.000Z",
    freshness: { riskZonesAgeSeconds: null, satellitesAgeSeconds: null, conjunctionsAgeSeconds: null },
    availability: { ...availability, satellites: true },
    counts: { riskZoneCount: 0, satelliteObjectCount: 0, highValueCount: 0, unidentifiedCount: 0, conjunctionCount: 0 },
    crowding: {
      maxRiskScore,
      avgRiskScore: 0,
      geoMaxRiskScore: 0,
      meoMaxRiskScore: 0,
      weightedObjectDensity: 0,
      unidentifiedRatio: 0,
    },
    conjunctionRisk: { maxCollisionProbability: null, minMissDistanceM: null, recentCriticalCount: 0 },
    learnedLane: {
      modelVersion: "test",
      score: 0.1,
      confidence: 0.5,
      trigger: false,
      threshold: 0.6,
      blend: 0,
      features: {
        conjunctionCount: 0,
        maxCollisionProbability: 0,
        inverseMissDistance: 0,
        debrisDensity: 0,
        highValueNeighborDensity: 0,
        unidentifiedRatio: 0,
        geoCrowdingScore: 0,
        meoCrowdingScore: 0,
        leoCrowdingScore: 0,
        tleFreshnessScore: 0,
        conjunctionFreshnessScore: 0,
        availabilityScore: 0,
      },
      topContributors: [],
    },
  };
}

describe("source health rollup", () => {
  it("is unknown, not healthy, with no sources at all", () => {
    expect(rollupSources([]).state).toBe("unknown");
  });

  it("is unknown when the only source is an unknown-truth probe, and counts no probe as nominal", () => {
    const rollup = rollupSources([JAXA_PROBE]);
    expect(rollup).toEqual({ state: "unknown", measuring: 0, healthy: 0, degraded: 0, probes: 1 });
  });

  it("judges health on measuring sources only", () => {
    expect(rollupSources([JAXA_PROBE, source("noaa-swpc", true)])).toMatchObject({ state: "healthy", healthy: 1, measuring: 1 });
    expect(rollupSources([JAXA_PROBE, source("noaa-swpc", false)])).toMatchObject({ state: "degraded", degraded: 1 });
  });
});

describe("public SDA analysis", () => {
  it("says catalog risk is unknown, not 0%, when the risk-zone feed is unavailable", () => {
    const analysis = buildDeterministicPublicAnalysis(summary({ riskZones: false, conjunctions: true }), null);
    expect(analysis.severity).toBe("unknown");
    expect(analysis.summary).not.toMatch(/0%/);
    expect(analysis.summary).toMatch(/risk-zone feed is unavailable/);
  });

  it("is unknown with no risk inputs at all", () => {
    const analysis = buildDeterministicPublicAnalysis(summary({ riskZones: false, conjunctions: false }), null);
    expect(analysis.severity).toBe("unknown");
    expect(analysis.headline).toBe("Orbital risk unknown");
  });

  it("overrides a backend 'quiet' when an input is missing", () => {
    const backend: SpaceDomainAnalysis = {
      ...buildDeterministicPublicAnalysis(summary({ riskZones: true, conjunctions: true }), null),
      severity: "quiet",
    };
    const analysis = buildDeterministicPublicAnalysis(summary({ riskZones: false, conjunctions: true }), backend);
    expect(analysis.severity).toBe("unknown");
  });

  it("still reports a measured catalog risk", () => {
    const analysis = buildDeterministicPublicAnalysis(summary({ riskZones: true, conjunctions: true }, 0.12), null);
    expect(analysis.severity).toBe("quiet");
    expect(analysis.summary).toMatch(/Catalog risk is 12%/);
  });
});

describe("operator timeline", () => {
  const base = { passes: [], gateAction: null, stormTier: "quiet", topRecommendedAction: null };

  it("raises an unknown sources alert when no measuring source is present", () => {
    render(<OperatorTimeline {...base} sourceHealth="unknown" />);
    expect(screen.getByText(/Unknown \(no measuring source\)/)).toBeInTheDocument();
  });

  it("raises a degraded alert for a degraded measuring source", () => {
    render(<OperatorTimeline {...base} sourceHealth="degraded" />);
    expect(screen.getByText(/Degraded/)).toBeInTheDocument();
  });

  it("raises no sources alert when measuring sources are healthy", () => {
    render(<OperatorTimeline {...base} sourceHealth="healthy" />);
    expect(screen.queryByText(/Unknown \(no measuring source\)|Degraded/)).not.toBeInTheDocument();
  });
});
