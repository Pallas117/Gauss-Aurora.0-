import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AutomationPage from "@/pages/AutomationPage";

const useMissionSnapshotMock = jest.fn();
const usePowerProfileMock = jest.fn();
const updateSourcePolicyOverrideMock = jest.fn();
const getAuthHeadersMock = jest.fn();
// The backend broker policy has no planner mode (backend/workers/mesh/broker.ts getPolicy).
let mockBrokerPolicy: Record<string, unknown> = {};

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => useMissionSnapshotMock(),
}));

jest.mock("@/hooks/usePowerProfile", () => ({
  usePowerProfile: () => usePowerProfileMock(),
}));

jest.mock("@/hooks/useOpsWorkerMesh", () => ({
  useOpsWorkerMesh: () => ({
    workers: [
      {
        id: "source-policy",
        lane: "runtime",
        enabled: true,
        approval: "safe-auto",
        state: "idle",
        lastRunAt: null,
        lastResult: null,
      },
    ],
    queue: {
      pendingTasks: [],
      queuedApprovals: [],
      brokerPolicy: mockBrokerPolicy,
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/lib/api/auth", () => ({
  getAuthHeaders: () => getAuthHeadersMock(),
}));

jest.mock("@/lib/api/operator-sources", () => ({
  updateSourcePolicyOverride: (...args: unknown[]) => updateSourcePolicyOverrideMock(...args),
}));

jest.mock("@/lib/power/polling", () => ({
  getAdaptivePollInterval: () => 10_000,
}));

jest.mock("@/components/ops/OpsLaneLinks", () => ({
  OpsLaneLinks: () => <div data-testid="ops-lane-links" />,
}));

describe("AutomationPage", () => {
  const originalFetch = global.fetch;
  const refreshMock = jest.fn();

  beforeEach(() => {
    mockBrokerPolicy = { memoryLevel: "nominal", autoSafeOps: true };
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    getAuthHeadersMock.mockResolvedValue({});
    usePowerProfileMock.mockReturnValue({
      profile: "nominal",
      isConstraintDetected: false,
      isLowPower: false,
    });
    useMissionSnapshotMock.mockReturnValue({
      session: {
        authRequired: true,
        authenticated: true,
        role: "operator",
        clearance: "mission",
        userId: "operator-1",
        email: "operator@example.com",
        emailVerified: true,
        features: { heliophysics: true, debris: true },
      },
      snapshot: {
        timestamp: "2026-03-07T12:00:00.000Z",
        sourceStatus: [
          {
            source: "noaa-swpc",
            lastSeen: "2026-03-07T12:00:00.000Z",
            latencySeconds: 5,
            healthy: true,
            powerDecision: "primary",
            utilityScore: 0.96,
            targetCadenceMs: 60000,
            policyReason: "storm=warning pressure=medium healthy=true burst=false",
            observedCostScore: 0.09,
            avgFetchDurationMs: 180,
            avgCpuMs: 8,
            avgPayloadKb: 12,
            sampleCount: 4,
            overrideDecision: "sample",
            overrideReason: "Pinned via automation controls",
            overrideUpdatedAt: "2026-03-07T12:01:00.000Z",
            overrideUpdatedBy: "operator-1",
          },
        ],
      },
      loading: false,
      error: null,
      pollingPaused: false,
      usingCachedData: false,
      cachedAt: null,
      lastSuccessfulSyncAt: Date.now(),
      refresh: refreshMock,
      refreshSession: jest.fn(),
    });
    updateSourcePolicyOverrideMock.mockResolvedValue({
      sourceStatus: {
        source: "noaa-swpc",
        lastSeen: "2026-03-07T12:00:00.000Z",
        latencySeconds: 5,
        healthy: true,
        overrideDecision: "suspend",
      },
      persisted: true,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        timestamp: "2026-03-07T12:00:00.000Z",
        status: {
          enabled: true,
          counters: {
            totalInspected: 5,
            blocked: 0,
            signatureHits: 0,
            rateLimited: 0,
          },
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("renders source override state and applies a new operator pin", async () => {
    render(<AutomationPage />);

    expect(screen.getByText(/specialist workers/i)).toBeInTheDocument();
    expect(screen.getByText(/source-policy/i)).toBeInTheDocument();
    expect(screen.getByTestId("automation-source-override-noaa-swpc")).toHaveTextContent(
      "override sample",
    );

    fireEvent.click(screen.getByTestId("automation-source-override-noaa-swpc-suspend"));

    await waitFor(() =>
      expect(updateSourcePolicyOverrideMock).toHaveBeenCalledWith("noaa-swpc", {
        overrideDecision: "suspend",
        overrideReason: "Pinned via automation controls",
      }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("noaa-swpc pinned to suspend.")).toBeInTheDocument(),
    );
  });

  test("shows the DeepSeek mode as unknown when the broker does not report it", async () => {
    render(<AutomationPage />);

    expect(await screen.findByText("DeepSeek unknown")).toBeInTheDocument();
    expect(screen.queryByText(/deepseek auto/i)).not.toBeInTheDocument();
  });

  test("shows the DeepSeek mode the broker reports", async () => {
    mockBrokerPolicy = { memoryLevel: "nominal", deepseekMode: "manual", autoSafeOps: true };
    render(<AutomationPage />);

    expect(await screen.findByText("DeepSeek manual")).toBeInTheDocument();
  });
});
