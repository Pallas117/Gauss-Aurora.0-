/** Small, deterministic memory-retention trend helper for admission decisions. */

export type MemoryGrowthTrend = "non_positive" | "positive" | "unknown";

export interface MemoryGrowthSample {
  currentMb: number | null;
  previousMb: number | null;
  growthMb: number | null;
  trend: MemoryGrowthTrend;
}

function finiteMb(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

export function sampleProcessRssMb(): number | null {
  return finiteMb(process.memoryUsage().rss / (1024 * 1024));
}

export function classifyMemoryGrowth(
  currentMb: number | null | undefined,
  previousMb: number | null | undefined,
  toleranceMb = 0,
): MemoryGrowthSample {
  const current = finiteMb(currentMb);
  const previous = finiteMb(previousMb);
  if (current === null || previous === null) {
    return { currentMb: current, previousMb: previous, growthMb: null, trend: "unknown" };
  }
  const growthMb = Math.round((current - previous) * 100) / 100;
  const tolerance = Math.max(0, Number.isFinite(toleranceMb) ? toleranceMb : 0);
  return {
    currentMb: current,
    previousMb: previous,
    growthMb,
    trend: growthMb > tolerance ? "positive" : "non_positive",
  };
}

export class MemoryGrowthTracker {
  private previousMb: number | null = null;

  sample(currentMb = sampleProcessRssMb(), toleranceMb = 0): MemoryGrowthSample {
    const sample = classifyMemoryGrowth(currentMb, this.previousMb, toleranceMb);
    this.previousMb = sample.currentMb;
    return sample;
  }

  reset(): void {
    this.previousMb = null;
  }
}
