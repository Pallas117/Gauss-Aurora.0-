/**
 * Pure scoring helpers for probability fusion. No I/O, testable in isolation.
 */

import { clamp } from "../physics/coordinates.js";

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function sigmoid(x: number, scale = 1, shift = 0): number {
  const safeScale = Math.abs(scale) > 1e-8 ? scale : 1e-8;
  return 1 / (1 + Math.exp(-(x - shift) / safeScale));
}

export function magnitude(values: number[]): number {
  const x = Number(values[0] ?? 0);
  const y = Number(values[1] ?? 0);
  const z = Number(values[2] ?? 0);
  return Math.hypot(x, y, z);
}

export function distance(a: number[], b: number[]): number {
  const dx = Number(a[0] ?? 0) - Number(b[0] ?? 0);
  const dy = Number(a[1] ?? 0) - Number(b[1] ?? 0);
  const dz = Number(a[2] ?? 0) - Number(b[2] ?? 0);
  return Math.hypot(dx, dy, dz);
}

export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absX * absX));
  return sign * y;
}

export function normalCdf(x: number, mean = 0, sigma = 1): number {
  const safeSigma = sigma > 0 ? sigma : 1e-8;
  const z = (x - mean) / (safeSigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

export function confidenceInterval(
  probability: number,
  uncertainty: number,
  coverage = 0.9,
): [number, number] {
  const p = clamp(probability, 0.01, 0.99);
  const u = clamp(uncertainty, 0, 1);
  const z = coverage >= 0.95 ? 1.96 : 1.645;
  const effectiveN = clamp((1 - u) * 120, 6, 200);
  const sigma = Math.sqrt((p * (1 - p)) / effectiveN);
  const width = z * sigma + u * 0.2;
  return [clamp01(p - width), clamp01(p + width)];
}
