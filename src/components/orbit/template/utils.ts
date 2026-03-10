import { Transform, type Vec3 } from "./primitives";
import type { MostLikelyInstance, OrbitAsset, OrbitThreat } from "./types";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function safeVec3(value: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const [x, y, z] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return fallback;
  return [x, y, z];
}

export function safeRadius(value: unknown, fallback = 1): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0.0001, value);
}

export function safeConfidence(value: unknown, fallback = 0.5): number {
  if (!isFiniteNumber(value)) return fallback;
  return clamp01(value);
}

export function clampFinite(value: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function expSmoothingAlpha(dt: number, tau: number): number {
  if (!(dt > 0) || !(tau > 0)) return 1;
  return 1 - Math.exp(-dt / tau);
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const full = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const safeAlpha = Math.max(0, Math.min(1, alpha));

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return `rgba(0,240,255,${safeAlpha})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function computeMostLikelyInstance(
  assets: OrbitAsset[],
  threat?: OrbitThreat,
): MostLikelyInstance {
  const atSeconds = 120;
  const center = safeVec3(threat?.center, [0, 0, 0]);

  let bestId: string | null = null;
  let bestPosition: Vec3 = [0, 0, 0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const asset of assets ?? []) {
    const predicted = Transform.temporalPrediction(
      safeVec3(asset.position),
      safeVec3(asset.velocity),
      atSeconds,
    );
    const dx = predicted[0] - center[0];
    const dy = predicted[1] - center[1];
    const dz = predicted[2] - center[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = asset.id;
      bestPosition = predicted;
    }
  }

  const radius = safeRadius(threat?.radius, 1);
  const confidence = clamp01(1 - bestDistance / (radius * 3));

  return {
    atSeconds,
    mostLikelyAssetId: bestId,
    predictedPosition: bestPosition,
    confidence,
    note:
      bestId === null
        ? "No assets provided; showing neutral instance."
        : `Selected by minimum distance to ${threat?.label ?? "threat"} at +${atSeconds}s.`,
  };
}
