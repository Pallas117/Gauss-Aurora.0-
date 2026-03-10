import type { Vec3 } from "./primitives";

export interface OrbitAsset {
  id: string;
  position: Vec3;
  velocity: Vec3;
  threatLevel: number;
}

export interface OrbitTrajectory {
  id: string;
  points: Vec3[];
  threatLevel: number;
}

export interface OrbitThreat {
  center: Vec3;
  radius: number;
  label: string;
}

export interface MostLikelyInstance {
  atSeconds: number;
  mostLikelyAssetId: string | null;
  predictedPosition: Vec3;
  confidence: number;
  note: string;
}
