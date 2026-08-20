import { canonicalSpaceWeatherPointSchema } from "@/lib/contracts/heliophysics";

describe("canonical radiation contract", () => {
  it("preserves GOES and supplemental ESA radiation provenance", () => {
    const parsed = canonicalSpaceWeatherPointSchema.parse({
      timestamp: "2026-07-17T00:00:00Z",
      source: "fusion",
      rho: 1,
      velocity: { x: -400, y: 0, z: 0, magnitude: 400 },
      magneticField: { x: 0, y: 0, z: -5, bt: 5 },
      electricField: { x: 0, y: 0, z: 0, ey: 0 },
      solarWind: { speed: 400, density: 5, dynamicPressure: 1 },
      indices: { kp: 4, dst: -20 },
      coupling: { newell: 1, epsilon: 1 },
      propagation: { l1DelaySeconds: 1500, etaEarthArrival: "2026-07-17T00:25:00Z" },
      alerts: { stormTier: "watch", reason: "test" },
      quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
      uncertainty: { speed: { lower: 390, upper: 410, sigma: 5 }, density: { lower: 4, upper: 6, sigma: 1 }, bz: { lower: -6, upper: -4, sigma: 1 } },
      radiation: { protonFlux10MeV: 10, electronFlux2MeV: 20, observedAt: "2026-07-17T00:00:00Z", source: "noaa-goes-seiss", platform: "primary" },
      supplementalRadiation: [{ observedAt: "2026-07-17T00:00:00Z", source: "esa-swe-ngrm", dataset: "d3s", protonFlux: 3, electronFlux: 4, protonEnergy: ">10 MeV", electronEnergy: ">2 MeV" }],
    });
    expect(parsed.radiation?.platform).toBe("primary");
    expect(parsed.supplementalRadiation?.[0]?.source).toBe("esa-swe-ngrm");
  });
});
