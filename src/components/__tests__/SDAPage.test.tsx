import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SDAPage from "@/pages/SDAPage";
import { useSDAState } from "@/hooks/useSDAState";

jest.mock("@/hooks/useSDAState", () => ({
  useSDAState: jest.fn(),
}));

jest.mock("@/contexts/AiContext", () => ({
  AiContextProvider: ({ children }: { children: ReactNode }) => children,
}));


jest.mock("@/components/ui/LayerToggles", () => ({
  LayerToggles: () => <div data-testid="layer-toggles" />,
}));

jest.mock("@/components/cockpit/AgenticActionCards", () => ({
  AgenticActionCards: () => <div data-testid="agentic-action-cards" />,
}));

jest.mock("@/components/heliophysics/TriadPanel", () => ({
  TriadPanel: () => <div data-testid="triad-panel" />,
}));

jest.mock("@/components/heliophysics/AuthSessionModal", () => ({
  AuthSessionModal: ({
    open,
  }: {
    open: boolean;
  }) => (open ? <div>Mission Access Portal</div> : null),
}));

const mockedUseSDAState = jest.mocked(useSDAState);

function buildSpaceDomainSummary() {
  return {
    updatedAt: new Date().toISOString(),
    freshness: {
      riskZonesAgeSeconds: 6,
      satellitesAgeSeconds: 8,
      conjunctionsAgeSeconds: 12,
    },
    availability: {
      riskZones: true,
      satellites: true,
      conjunctions: true,
    },
    counts: {
      riskZoneCount: 2,
      satelliteObjectCount: 2,
      highValueCount: 1,
      unidentifiedCount: 1,
      conjunctionCount: 3,
    },
    crowding: {
      maxRiskScore: 0.74,
      avgRiskScore: 0.61,
      geoMaxRiskScore: 0.74,
      meoMaxRiskScore: 0.51,
      weightedObjectDensity: 0.42,
      unidentifiedRatio: 0.5,
    },
    conjunctionRisk: {
      maxCollisionProbability: 0.0024,
      minMissDistanceM: 145,
      recentCriticalCount: 1,
    },
    learnedLane: {
      modelVersion: "ssa-test",
      score: 0.63,
      confidence: 0.77,
      trigger: true,
      threshold: 0.58,
      blend: 0.66,
      features: {
        conjunctionCount: 3,
        maxCollisionProbability: 0.0024,
        inverseMissDistance: 1 / 145,
        debrisDensity: 0.42,
        highValueNeighborDensity: 0.67,
        unidentifiedRatio: 0.5,
        geoCrowdingScore: 0.74,
        meoCrowdingScore: 0.51,
        leoCrowdingScore: 0.18,
        tleFreshnessScore: 0.93,
        conjunctionFreshnessScore: 0.87,
        availabilityScore: 1,
      },
      topContributors: [
        { name: "conjunctionCount", weight: 0.31, value: 3, contribution: 0.19 },
      ],
    },
  };
}

function buildSpaceDomainAnalysis() {
  return {
    generatedAt: new Date().toISOString(),
    cadenceSeconds: 30,
    source: "deterministic" as const,
    severity: "warning" as const,
    headline: "Elevated orbital risk requires attention",
    summary:
      "Elevated SSA pressure detected: learned lane 63%, catalog risk 74%, and 3 conjunctions under watch.",
    confidence: 0.82,
    changed: true,
    changedSignals: ["conjunction-count", "collision-probability"],
    metrics: {
      learnedLaneScore: 0.63,
      maxRiskScore: 0.74,
      maxCollisionProbability: 0.0024,
      minMissDistanceM: 145,
      conjunctionCount: 3,
    },
    model: {
      used: false,
      modelId: null,
      generatedAt: null,
    },
  };
}

function buildState(authenticated = false) {
  return {
    canvasRef: { current: null },
    presentation: false,
    mission: {
      session: {
        authRequired: true,
        authenticated,
        role: authenticated ? "operator" : null,
        clearance: authenticated ? "mission" : null,
        userId: authenticated ? "operator-1" : null,
        email: authenticated ? "operator@example.com" : null,
        emailVerified: authenticated,
      },
      snapshot: null,
      loading: false,
      error: null,
      refresh: jest.fn(),
      refreshSession: jest.fn().mockResolvedValue({
        authRequired: true,
        authenticated,
      }),
    },
    canViewProtectedFeeds: authenticated,
    debrisEnabled: true,
    mms: {
      vectors: [],
      source: "none",
      error: null,
    },
    spaceDomain: {
      summary: buildSpaceDomainSummary(),
      analysis: buildSpaceDomainAnalysis(),
      analysisTrend: [0.41, 0.47, 0.58, 0.63],
      loading: false,
      error: null,
    },
    publicAnalysis: buildSpaceDomainAnalysis(),
    analysisTrend: [0.41, 0.47, 0.58, 0.63],
    satelliteData: {
      highValue: [
        {
          noradId: "10001",
          name: "SAT-A",
          orbitType: "GEO",
          altitudeKm: 35786,
        },
      ],
      unidentified: [
        {
          noradId: "10002",
          name: "OBJ-X",
          orbitType: "MEO",
          altitudeKm: 20180,
        },
      ],
      updatedAt: new Date().toISOString(),
    },
    latest: null,
    vectorOverlay: null,
    sceneData: [],
    layers: {
      earth: true,
      belts: true,
      magnetosphere: true,
      fieldLines: true,
      mhdWaves: true,
      mmsReconnection: true,
      radiationData: true,
    },
    setLayers: jest.fn(),
    visual: {
      magnetopauseCompression: 0.84,
      beltIntensity: 0.48,
      reconnectionStrength: 0.22,
    },
    disabledLayers: {},
    useLiteSdaScene: true,
    liteSdaReason: "Compact viewport detected: using a lightweight SDA map for faster interaction.",
    logOperatorAction: jest.fn(),
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sda"]}>
      <Routes>
        <Route path="/sda" element={<SDAPage />} />
        <Route path="/command" element={<div>Command Mock</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SDAPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps public SDA live and opens the auth modal from the mission control CTA", () => {
    mockedUseSDAState.mockReturnValue(buildState(false) as never);

    renderPage();

    expect(screen.getByText(/public sda stays live off the space-domain store/i)).toBeInTheDocument();
    expect(screen.getByText(/public sda active/i)).toBeInTheDocument();
    expect(screen.getByText(/public sda analysis/i)).toBeInTheDocument();


    fireEvent.click(screen.getByRole("button", { name: /login for mission control/i }));

    expect(screen.getByText(/mission access portal/i)).toBeInTheDocument();
  });

  it("sends authenticated users straight into mission control", () => {
    mockedUseSDAState.mockReturnValue(buildState(true) as never);

    renderPage();

    fireEvent.click(screen.getByRole("link", { name: /open mission control/i }));

    expect(screen.getByText(/command mock/i)).toBeInTheDocument();
  });
});
