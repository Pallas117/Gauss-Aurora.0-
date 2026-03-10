import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "@/app/Layout";

jest.mock("@/hooks/useTuringDevices", () => ({
  useTuringSummary: () => ({ summary: null }),
  useTuringDevices: () => ({ devices: [], loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock("@/lib/auth-env-check", () => ({
  getSupabaseEnvStatus: () => ({ configured: true }),
}));
jest.mock("@/hooks/useOfflineMode", () => ({
  useOfflineMode: () => ({ isOffline: false, staleData: false, staleAgeMs: null }),
}));
jest.mock("@/components/DisplayCustomizer", () => ({
  DisplayCustomizer: () => <div data-testid="display-customizer" />,
}));
jest.mock("@/components/OnboardingGuard", () => ({
  OnboardingGuard: () => null,
}));
jest.mock("@/components/cockpit/RiskHudBanner", () => ({
  RiskHudBanner: () => null,
}));
jest.mock("@/components/cockpit/OfflineResilienceBanner", () => ({
  OfflineResilienceBanner: () => null,
}));
jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => ({
    session: {
      authRequired: true,
      authenticated: true,
      role: "operator",
      clearance: "mission",
      userId: "mock-user",
      email: "operator@example.com",
      emailVerified: true,
    },
    snapshot: {
      canonicalLatest: {
        alerts: { stormTier: "warning" },
      },
      sourceStatus: [{ source: "noaa-swpc", healthy: true }],
      timestamp: new Date().toISOString(),
    },
    pollingPaused: false,
    loading: false,
    error: null,
    refresh: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

function renderShell(initialPath = "/command") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="command" element={<h2>Command Mock</h2>} />
          <Route path="sda" element={<h2>SDA Mock</h2>} />
          <Route path="systems" element={<h2>Systems Mock</h2>} />
          <Route path="intel" element={<h2>Intel Mock</h2>} />
          <Route path="heliophysics" element={<h2>Helio Mock</h2>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("App shell layout", () => {
  it("renders command route with shell navigation", () => {
    renderShell();

    expect(screen.getByText(/GAUSS AURORA/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Command Mock/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SDA/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Systems/i })).toBeInTheDocument();
  });

  it("navigates across shell links", () => {
    renderShell();

    fireEvent.click(screen.getByRole("link", { name: /SDA/i }));
    expect(screen.getByRole("heading", { name: /SDA Mock/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Systems/i }));
    expect(screen.getByRole("heading", { name: /Systems Mock/i })).toBeInTheDocument();
  });
});
