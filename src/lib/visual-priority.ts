import type {
  RadiationDataPoint,
  RiskZonePoint,
  VisualizationPoint,
} from "@/lib/types/radiation";
import { isRiskZonePoint } from "@/lib/types/radiation";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseTimestampMs(timestamp: string | undefined): number {
  if (!timestamp) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orbitBias(point: { orbitType: "LEO" | "MEO" | "GEO" }): number {
  if (point.orbitType === "GEO") {
    return 0.12;
  }
  if (point.orbitType === "MEO") {
    return 0.08;
  }
  return 0.04;
}

export function computeRadiationVisualPriority(point: RadiationDataPoint): number {
  const fluxNorm = clamp01((Math.log10(Math.max(point.flux, 1)) - 2) / 4);
  const lShellNorm = clamp01(point.L_shell / 6.6);
  return clamp01(fluxNorm * 0.72 + lShellNorm * 0.16 + orbitBias(point) + 0.04);
}

export function computeRiskZoneVisualPriority(point: RiskZonePoint): number {
  const riskNorm = clamp01(point.riskScore);
  const objectDensityNorm = clamp01((point.objectCount ?? 0) / 40);
  return clamp01(riskNorm * 0.72 + objectDensityNorm * 0.12 + orbitBias(point) + 0.08);
}

export function getVisualizationPriorityScore(point: VisualizationPoint): number {
  if (typeof point.visualPriorityScore === "number" && Number.isFinite(point.visualPriorityScore)) {
    return point.visualPriorityScore;
  }
  return isRiskZonePoint(point)
    ? computeRiskZoneVisualPriority(point)
    : computeRadiationVisualPriority(point);
}

export function withVisualizationPriority<T extends VisualizationPoint>(point: T): T {
  if (typeof point.visualPriorityScore === "number" && Number.isFinite(point.visualPriorityScore)) {
    return point;
  }
  return {
    ...point,
    visualPriorityScore: getVisualizationPriorityScore(point),
  };
}

export function compareVisualizationPriority(a: VisualizationPoint, b: VisualizationPoint): number {
  const scoreDelta = getVisualizationPriorityScore(b) - getVisualizationPriorityScore(a);
  if (Math.abs(scoreDelta) > 1e-9) {
    return scoreDelta;
  }
  return parseTimestampMs(b.timestamp) - parseTimestampMs(a.timestamp);
}

export function prioritizeVisualizationPoints<T extends VisualizationPoint>(
  points: T[],
  maxPoints = points.length,
): T[] {
  return points
    .map((point) => withVisualizationPriority(point))
    .sort(compareVisualizationPriority)
    .slice(0, maxPoints) as T[];
}
