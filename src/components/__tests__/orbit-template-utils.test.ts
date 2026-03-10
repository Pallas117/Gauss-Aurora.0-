import { createOrbitCollisionThreat, createOrbitDemoAssets, createOrbitDemoTrajectories } from "@/components/orbit/template/demo-data";
import { Transform } from "@/components/orbit/template/primitives";
import type { OrbitAsset } from "@/components/orbit/template/types";
import { computeMostLikelyInstance, hexToRgba } from "@/components/orbit/template/utils";

describe("orbit template utilities", () => {
  it("creates stable demo assets and trajectories with aligned ids", () => {
    const assets = createOrbitDemoAssets();
    const trajectories = createOrbitDemoTrajectories(assets);

    expect(assets).toHaveLength(12);
    expect(assets[0]?.id).toBe("SAT-1");
    expect(assets[11]?.id).toBe("SAT-12");
    expect(assets.every((asset) => asset.position.every(Number.isFinite))).toBe(true);
    expect(assets.every((asset) => asset.velocity.every(Number.isFinite))).toBe(true);

    expect(trajectories).toHaveLength(assets.length);
    expect(trajectories.every((trajectory, index) => trajectory.id === assets[index]?.id)).toBe(true);
    expect(trajectories.every((trajectory) => trajectory.points.length === 128)).toBe(true);
  });

  it("computes the most likely instance from temporal prediction distance", () => {
    const assets: OrbitAsset[] = [
      {
        id: "SAT-A",
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        threatLevel: 0.1,
      },
      {
        id: "SAT-B",
        position: [1, 0, 0],
        velocity: [0.1, 0, 0],
        threatLevel: 0.2,
      },
    ];

    const threat = {
      center: [13, 0, 0] as [number, number, number],
      radius: 2,
      label: "Conjunction Risk",
    };

    const instance = computeMostLikelyInstance(assets, threat);

    expect(instance.mostLikelyAssetId).toBe("SAT-B");
    expect(instance.predictedPosition).toEqual(
      Transform.temporalPrediction([1, 0, 0], [0.1, 0, 0], 120),
    );
    expect(instance.confidence).toBeCloseTo(1, 5);
    expect(instance.note).toMatch(/conjunction risk/i);
  });

  it("converts orbit colors to rgba and clamps invalid input safely", () => {
    expect(hexToRgba("#abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
    expect(hexToRgba("zzzzzz", 9)).toBe("rgba(0,240,255,1)");
  });

  it("ships a collision threat that the split shell can render directly", () => {
    const threat = createOrbitCollisionThreat();

    expect(threat.label).toBe("Conjunction Risk");
    expect(threat.radius).toBeGreaterThan(0);
  });
});
