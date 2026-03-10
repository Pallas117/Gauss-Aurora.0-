import type { OrbitAsset, OrbitThreat, OrbitTrajectory } from "./types";
import type { Vec3 } from "./primitives";

export function createOrbitDemoAssets(): OrbitAsset[] {
  return Array.from({ length: 12 }).map((_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    const radius = 3.2 + (index % 3) * 0.4;

    return {
      id: `SAT-${index + 1}`,
      position: [Math.cos(angle) * radius, index % 2 ? 0.5 : -0.4, Math.sin(angle) * radius] as Vec3,
      velocity: [-Math.sin(angle) * 0.2, 0, Math.cos(angle) * 0.2] as Vec3,
      threatLevel: (index % 5) / 4,
    };
  });
}

export function createOrbitDemoTrajectories(assets: OrbitAsset[]): OrbitTrajectory[] {
  return assets.map((asset) => {
    const points: Vec3[] = [];
    const orbitRadius = Math.sqrt(asset.position[0] ** 2 + asset.position[2] ** 2);

    for (let step = 0; step < 128; step += 1) {
      const theta = (step / 128) * Math.PI * 2;
      points.push([
        Math.cos(theta) * orbitRadius,
        asset.position[1],
        Math.sin(theta) * orbitRadius,
      ]);
    }

    return {
      id: asset.id,
      points,
      threatLevel: asset.threatLevel,
    };
  });
}

export function createOrbitCollisionThreat(): OrbitThreat {
  return {
    center: [1.4, 0.1, -0.6],
    radius: 1.1,
    label: "Conjunction Risk",
  };
}
