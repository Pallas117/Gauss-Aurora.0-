/**
 * Pure helpers for MMS probability fusion. Testable in isolation.
 */

import { vec, type Vector3 } from "./coordinates.js";

export function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

export function mixVec(a: Vector3, b: Vector3, t: number): Vector3 {
  return vec(mix(a.x, b.x, t), mix(a.y, b.y, t), mix(a.z, b.z, t));
}

export function confidenceScore(confidence: "high" | "medium" | "low"): number {
  if (confidence === "high") return 1;
  if (confidence === "medium") return 0.65;
  return 0.35;
}

export function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.78) return "high";
  if (score >= 0.48) return "medium";
  return "low";
}
