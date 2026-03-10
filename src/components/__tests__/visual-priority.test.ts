import {
  compareVisualizationPriority,
  computeRadiationVisualPriority,
  computeRiskZoneVisualPriority,
  prioritizeVisualizationPoints,
  withVisualizationPriority,
} from "@/lib/visual-priority";
import type { RadiationDataPoint, RiskZonePoint } from "@/lib/types/radiation";

describe("visual priority scoring", () => {
  it("prioritizes high-risk zones ahead of low-signal radiation points", () => {
    const lowFluxRadiation: RadiationDataPoint = {
      timestamp: "2026-03-05T12:00:00.000Z",
      flux: 120,
      altitude: 550,
      L_shell: 1.6,
      orbitType: "LEO",
      particleType: "electron",
      energyRange: { min: 0.1, max: 5 },
    };
    const highRiskZone: RiskZonePoint = {
      timestamp: "2026-03-05T12:05:00.000Z",
      orbitType: "GEO",
      altitude: 35786,
      riskScore: 0.96,
      objectCount: 31,
    };

    expect(computeRadiationVisualPriority(lowFluxRadiation)).toBeLessThan(
      computeRiskZoneVisualPriority(highRiskZone),
    );

    const prioritized = prioritizeVisualizationPoints([lowFluxRadiation, highRiskZone]);

    expect(prioritized[0]).toMatchObject({ riskScore: 0.96, orbitType: "GEO" });
    expect(prioritized[1]).toMatchObject({ flux: 120, orbitType: "LEO" });
  });

  it("preserves explicit priority scores and breaks ties by recency", () => {
    const older = withVisualizationPriority({
      timestamp: "2026-03-05T12:00:00.000Z",
      flux: 2000,
      altitude: 20200,
      L_shell: 3.2,
      orbitType: "MEO" as const,
      particleType: "electron" as const,
      energyRange: { min: 0.1, max: 5 },
      visualPriorityScore: 0.8,
    });
    const newer = withVisualizationPriority({
      timestamp: "2026-03-05T12:05:00.000Z",
      orbitType: "GEO" as const,
      altitude: 35786,
      riskScore: 0.2,
      objectCount: 5,
      visualPriorityScore: 0.8,
    });

    expect(compareVisualizationPriority(older, newer)).toBeGreaterThan(0);

    const prioritized = prioritizeVisualizationPoints([older, newer]);
    expect(prioritized[0]).toBe(newer);
    expect(prioritized[1]).toBe(older);
  });
});
