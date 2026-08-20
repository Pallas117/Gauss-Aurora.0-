import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GaussPlatformPage from "@/pages/GaussPlatformPage";

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => ({
    snapshot: {
      timestamp: "2026-08-19T00:00:00.000Z",
      source: "memory",
      canonicalLatest: {
        timestamp: "2026-08-19T00:00:00.000Z",
        source: "fixture",
        solarWind: { speed: 540, density: 7.5, dynamicPressure: 2.8 },
        magneticField: { x: 0, y: 0, z: -4.2, bt: 4.2 },
        quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
      },
      sourceStatus: [{ source: "fixture", healthy: true }],
    },
    session: { authRequired: false, authenticated: false },
    loading: false,
    error: null,
    usingCachedData: false,
    lastSuccessfulSyncAt: Date.now(),
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useOfflineMode", () => ({
  useOfflineMode: () => ({ isOffline: false, staleData: false, staleAgeMs: 0 }),
}));

jest.mock("@/hooks/usePowerProfile", () => ({
  usePowerProfile: () => ({ profile: "balanced", isLowPower: false }),
}));

jest.mock("@/hooks/useTuringDevices", () => ({
  useTuringSummary: () => ({
    summary: { total: 5, healthy: 4, stale: 1, offline: 0, pending: 0, generated_at: "2026-08-19T00:00:00.000Z" },
    loading: false,
    refresh: jest.fn(),
  }),
}));

describe("Gauss Platform workspace", () => {
  it("renders the end-to-end product surface and trust-zone map", () => {
    render(
      <MemoryRouter>
        <GaussPlatformPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("gauss-platform-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Make every mission byte count/i })).toBeInTheDocument();
    expect(screen.getByTestId("gauss-fabric-map")).toBeInTheDocument();
    expect(screen.getByTestId("maven-mission-theater")).toBeInTheDocument();
    expect(screen.getByTestId("maven-replay-scrubber")).toBeInTheDocument();
    expect(screen.getByText("Solar-storm response")).toBeInTheDocument();
    expect(screen.getByText("MEO BRIDGE")).toBeInTheDocument();
    expect(screen.getByText("World models advise. Physics decides.")).toBeInTheDocument();
    expect(screen.getByText("command authority disabled")).toBeInTheDocument();
  });

  it("keeps replay interaction explicit and blocks an unconfigured live adapter", () => {
    render(
      <MemoryRouter>
        <GaussPlatformPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /live adapter/i }));
    expect(screen.getByText(/Live adapter boundary/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /return to replay/i }));
    expect(screen.queryByText(/Live adapter boundary/i)).not.toBeInTheDocument();

    const scrubber = screen.getByRole("slider", { name: /MAVEN replay time/i });
    fireEvent.change(scrubber, { target: { value: "5" } });
    expect(screen.getByText("Quality gate recovery")).toBeInTheDocument();
  });
});
