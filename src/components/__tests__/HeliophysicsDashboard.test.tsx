import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const useMissionSnapshotMock = jest.fn();
const useOfflineModeMock = jest.fn();
const useSolarWind5sMock = jest.fn();
const useMMSReconnectionMock = jest.fn();
const useAuroraMapMock = jest.fn();
const usePowerProfileMock = jest.fn();
const useBackendHealthMock = jest.fn();
const useMissionCoreSnapshotMock = jest.fn();
const useSuryaForecastMock = jest.fn();
const getAuthHeadersMock = jest.fn();

jest.mock("@/components/GaussRagPanel", () => ({
  GaussRagPanel: () => <div data-testid="rag-panel" />,
}));

jest.mock("@/components/heliophysics/SolarWindSpeedChart", () => ({
  SolarWindSpeedChart: () => <div data-testid="solar-wind-chart" />,
}));

jest.mock("@/components/heliophysics/AuroraCastMap", () => ({
  AuroraCastMap: () => <div data-testid="aurora-map" />,
}));

jest.mock("@/components/heliophysics/FeedbackPanel", () => ({
  FeedbackPanel: () => <div data-testid="feedback-panel-mock" />,
}));

jest.mock("@/components/heliophysics/AuthSessionModal", () => ({
  AuthSessionModal: () => null,
}));

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => useMissionSnapshotMock(),
}));

jest.mock("@/hooks/useOfflineMode", () => ({
  useOfflineMode: () => useOfflineModeMock(),
}));

jest.mock("@/hooks/useSolarWind5s", () => ({
  useSolarWind5s: () => useSolarWind5sMock(),
}));

jest.mock("@/hooks/useMMSReconnection", () => ({
  useMMSReconnection: () => useMMSReconnectionMock(),
}));

jest.mock("@/hooks/useAuroraMap", () => ({
  useAuroraMap: () => useAuroraMapMock(),
}));

jest.mock("@/hooks/usePowerProfile", () => ({
  usePowerProfile: () => usePowerProfileMock(),
}));

jest.mock("@/hooks/useBackendHealth", () => ({
  useBackendHealth: () => useBackendHealthMock(),
}));

jest.mock("@/hooks/useMissionCoreSnapshot", () => ({
  useMissionCoreSnapshot: () => useMissionCoreSnapshotMock(),
}));

jest.mock("@/hooks/useSuryaForecast", () => ({
  useSuryaForecast: () => useSuryaForecastMock(),
}));

jest.mock("@/lib/api/auth", () => ({
  getAuthHeaders: () => getAuthHeadersMock(),
}));

jest.mock("@/lib/power/polling", () => ({
  getAdaptivePollInterval: (ms: number) => ms,
}));

const HeliophysicsDashboard = require("@/pages/HeliophysicsDashboard").default;

const canonicalLatest = {
  timestamp: "2026-03-05T12:00:00.000Z",
  source: "fusion",
  rho: 7.5,
  velocity: { x: -420, y: 18, z: -9, magnitude: 445.2 },
  magneticField: { x: 2.3, y: -1.1, z: -5.4, bt: 6.2 },
  electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
  solarWind: { speed: 445.2, density: 7.5, dynamicPressure: 2.8 },
  indices: { kp: 4, dst: -48 },
  coupling: { newell: 12800, epsilon: 812345 },
  propagation: {
    l1DelaySeconds: 1680,
    etaEarthArrival: "2026-03-05T12:28:00.000Z",
  },
  alerts: { stormTier: "warning", reason: "baseline" },
  quality: {
    outlier: false,
    stale: false,
    interpolated: false,
    extrapolated: false,
    lowConfidence: false,
  },
  uncertainty: {
    speed: { lower: 408, upper: 482, sigma: 18.5 },
    density: { lower: 6.9, upper: 8.1, sigma: 0.6 },
    bz: { lower: -6.2, upper: -4.6, sigma: 0.8 },
  },
  diagnostics: {
    shueR0Re: 8.77,
    alfvenSpeedKmS: 410,
    clockAngleRad: -2.94,
  },
} as const;

function setupDefaultMocks() {
  useMissionSnapshotMock.mockReturnValue({
    session: {
      authRequired: true,
      authenticated: true,
      role: "operator",
      clearance: "mission",
      userId: "test-user",
      email: "operator@example.com",
      emailVerified: true,
      features: { heliophysics: true, debris: true },
    },
    snapshot: {
      timestamp: canonicalLatest.timestamp,
      source: "supabase",
      canonicalLatest,
      mmsLatest: null,
      auroraLatest: null,
      threatSummary: {
        timestamp: canonicalLatest.timestamp,
        source: "supabase",
        lookbackMs: 1800000,
        count: 1,
        gate: {
          is_urgent: true,
          action: "TRIGGER_LLM",
          confidence: 88,
          reason: "test gate",
          flux_proxy: 0.0002,
          flux_latest: 0.00021,
          flux_mean: 0.0002,
          flux_max: 0.00024,
        },
        summary: {
          threat_count: 1,
          actionable_threat_count: 1,
          top_threat_type: "solar_flare",
          top_threat_score: 0.81,
          top_recommended_action: "Monitor",
        },
        threats: [
          {
            id: "th-1",
            type: "solar_flare",
            probability: 0.82,
            confidence_interval: [0.7, 0.93],
            factors: [
              { name: "Active Region", weight: 0.5, value: 4.1, contribution: 0.89 },
            ],
            composite_score: 0.81,
            actionable: true,
            recommended_action: "Monitor",
          },
        ],
      },
      sourceStatus: [
        {
          source: "noaa-swpc",
          lastSeen: canonicalLatest.timestamp,
          latencySeconds: 12,
          healthy: true,
          powerDecision: "primary",
          utilityScore: 0.97,
          targetCadenceMs: 60000,
          policyReason: "storm=warning pressure=medium healthy=true burst=false",
          observedCostScore: 0.08,
          avgFetchDurationMs: 210,
          avgCpuMs: 9,
          avgPayloadKb: 14,
          sampleCount: 6,
        },
      ],
      freshness: { canonicalAgeSeconds: 2, mmsAgeSeconds: null, auroraAgeSeconds: null },
      auth: { role: "operator", clearance: "mission", userId: "test-user" },
      vectorOverlay: undefined,
    },
    loading: false,
    error: null,
    pollingPaused: false,
    usingCachedData: false,
    cachedAt: null,
    lastSuccessfulSyncAt: Date.now(),
    refresh: jest.fn(),
    refreshSession: jest.fn(),
  });

  useOfflineModeMock.mockReturnValue({
    isOffline: false,
    staleData: false,
    staleAgeMs: null,
  });

  useSolarWind5sMock.mockReturnValue({
    latest: canonicalLatest,
    points: [canonicalLatest],
    loading: false,
    error: null,
    source: "supabase",
  });

  useMMSReconnectionMock.mockReturnValue({
    vectors: [],
    latest: null,
    loading: false,
    error: null,
  });

  useAuroraMapMock.mockReturnValue({
    map: null,
    loading: false,
    error: null,
  });

  usePowerProfileMock.mockReturnValue({
    profile: "balanced",
    isLowPower: false,
  });

  useBackendHealthMock.mockReturnValue({
    health: {
      ok: true,
      timestamp: new Date().toISOString(),
      memory: {
        level: "nominal",
        freeMb: 4096,
        suspendedSubsystems: [],
        svgLiteForced: false,
        externalModelMode: "auto",
      },
    },
    loading: false,
    error: null,
    memoryLevel: "nominal",
    deepseekMode: "auto",
    svgLiteForced: false,
  });

  useMissionCoreSnapshotMock.mockReturnValue({
    data: { passes: [] },
    loading: false,
    error: null,
    refresh: jest.fn(),
  });

  useSuryaForecastMock.mockReturnValue({
    data: null,
    fetchForecast: jest.fn(),
    loading: false,
    error: null,
  });

  getAuthHeadersMock.mockResolvedValue({});
}

describe("HeliophysicsDashboard nowcast visualization mapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
    process.env.VITE_FEATURE_SURYA_STUB = "false";
    process.env.VITE_FEATURE_SURYA_3D_LIVE = "false";
  });

  it("maps manual nowcast output into scene inputs and operator summary", async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: "learned-nowcast-v3",
        generatedAt: "2026-03-05T12:01:00.000Z",
        horizonMinutes: 30,
        predictions: [
          {
            timestamp: "2026-03-05T12:06:00.000Z",
            geomagneticPerturbation: 72,
            auroraIntensity: 0.88,
            confidence: 0.92,
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/heliophysics"]}>
        <HeliophysicsDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("mhd-effects-scene")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /run 30m nowcast/i }));

    await waitFor(() =>
      expect(screen.getByText(/manual nowcast mapped to scene/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("nowcast-model-version")).toHaveTextContent("learned-nowcast-v3");
    expect(screen.getByTestId("nowcast-visual-signal")).toHaveTextContent("perturb 72.0");
    expect(screen.getByTestId("nowcast-horizon-frame")).toHaveTextContent("1/1");

    expect(screen.getByText(/RECONNECTION · Bz/i)).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it("plays through the nowcast horizon frames in the live scene", async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: "learned-nowcast-v4",
        generatedAt: "2026-03-05T12:01:00.000Z",
        horizonMinutes: 30,
        predictions: [
          {
            timestamp: "2026-03-05T12:06:00.000Z",
            geomagneticPerturbation: 24,
            auroraIntensity: 0.34,
            confidence: 0.88,
          },
          {
            timestamp: "2026-03-05T12:11:00.000Z",
            geomagneticPerturbation: 72,
            auroraIntensity: 0.89,
            confidence: 0.91,
          },
        ],
      }),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={["/heliophysics"]}>
        <HeliophysicsDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("mhd-effects-scene")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run 30m nowcast/i }));

    await waitFor(() => expect(screen.getByTestId("nowcast-horizon-frame")).toHaveTextContent("1/2"));
    await waitFor(() => expect(screen.getByTestId("nowcast-horizon-frame")).toHaveTextContent("2/2"), {
      timeout: 5000,
    });

    expect(screen.getByText(/RECONNECTION · Bz/i)).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it("renders a stable SVG scene without the WebGL scene dependency", async () => {
    render(
      <MemoryRouter initialEntries={["/heliophysics"]}>
        <HeliophysicsDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("mhd-effects-scene")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: /schematic magnetohydrodynamic view/i })).toBeInTheDocument();
  });

  it("renders source policy and observed backend cost in the source health card", async () => {
    render(
      <MemoryRouter initialEntries={["/heliophysics"]}>
        <HeliophysicsDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("mhd-effects-scene")).toBeInTheDocument());

    const policyCard = await screen.findByTestId("source-policy-noaa-swpc");
    expect(policyCard).toHaveTextContent("primary");
    expect(policyCard).toHaveTextContent("cadence 1m");
    expect(policyCard).toHaveTextContent("utility 0.97");
    expect(policyCard).toHaveTextContent("cost 0.08");
    expect(policyCard).toHaveTextContent("fetch 210 ms");
    expect(policyCard).toHaveTextContent("payload 14.0 kB");
    expect(policyCard).toHaveTextContent("samples 6");
  });
});
