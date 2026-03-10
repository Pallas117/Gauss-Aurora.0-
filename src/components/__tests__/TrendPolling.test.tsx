import "@testing-library/jest-dom";
import { act, render } from "@testing-library/react";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";
import {
  analyzeTrendSamples,
  appendTrendSample,
  type TrendSample,
} from "@/lib/power/polling";

function RealtimeFeedHarness({
  fetcher,
}: {
  fetcher: () => Promise<{ value: number; timestampMs: number }>;
}) {
  useRealtimeFeed({
    fetcher,
    initialData: { value: 0, timestampMs: 0 },
    intervalMs: 5_000,
    enabled: true,
    trendSampling: {
      selectMetric: (data) => data.value,
      selectTimestampMs: (data) => data.timestampMs,
      maxMultiplier: 3,
    },
  });

  return null;
}

async function advanceTimers(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("trend-aware polling", () => {
  it("keeps a bounded trend history and replaces identical timestamps", () => {
    const seed: TrendSample[] = [];
    const withFirst = appendTrendSample(seed, { timestampMs: 1_000, value: 10 }, { maxSamples: 2 });
    const replaced = appendTrendSample(withFirst, { timestampMs: 1_000, value: 11 }, { maxSamples: 2 });
    const bounded = appendTrendSample(replaced, { timestampMs: 2_000, value: 12 }, { maxSamples: 1 });

    expect(replaced).toEqual([{ timestampMs: 1_000, value: 11 }]);
    expect(bounded).toEqual([{ timestampMs: 2_000, value: 12 }]);
  });

  it("backs off when recent samples fit a stable linear trend", () => {
    const samples: TrendSample[] = [
      { timestampMs: 0, value: 10 },
      { timestampMs: 5_000, value: 11 },
      { timestampMs: 10_000, value: 12 },
      { timestampMs: 15_000, value: 13 },
      { timestampMs: 20_000, value: 14 },
    ];

    const analysis = analyzeTrendSamples(samples, 5_000);

    expect(analysis.sampleCount).toBe(samples.length);
    expect(analysis.normalizedError).toBeCloseTo(0, 5);
    expect(analysis.recommendedMultiplier).toBeGreaterThan(1.5);
  });

  it("stays near base cadence when recent samples are noisy", () => {
    const samples: TrendSample[] = [
      { timestampMs: 0, value: 10 },
      { timestampMs: 5_000, value: 18 },
      { timestampMs: 10_000, value: 9 },
      { timestampMs: 15_000, value: 17 },
      { timestampMs: 20_000, value: 8 },
    ];

    const analysis = analyzeTrendSamples(samples, 5_000);

    expect(analysis.normalizedError).toBeGreaterThan(0.18);
    expect(analysis.recommendedMultiplier).toBe(1);
  });

  it("uses the trend model to reduce realtime feed sampling once the signal is predictable", async () => {
    jest.useFakeTimers();

    let index = 0;
    const fetcher = jest.fn(async () => {
      const value = 10 + index;
      const sample = { value, timestampMs: index * 5_000 };
      index += 1;
      return sample;
    });

    let view: ReturnType<typeof render> | null = null;
    await act(async () => {
      view = render(<RealtimeFeedHarness fetcher={fetcher} />);
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);

    await advanceTimers(5_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await advanceTimers(5_000);
    expect(fetcher).toHaveBeenCalledTimes(3);

    await advanceTimers(5_000);
    expect(fetcher).toHaveBeenCalledTimes(4);

    await advanceTimers(6_000);
    expect(fetcher).toHaveBeenCalledTimes(4);

    view?.unmount();
    jest.useRealTimers();
  });
});
