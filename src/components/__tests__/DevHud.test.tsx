import { act, fireEvent, render, screen } from "@testing-library/react";
import DevHud from "@/pages/DevHud";

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => ({
    session: {
      authRequired: true,
      authenticated: true,
      role: "operator",
      clearance: "mission",
    },
  }),
}));

jest.mock("@/hooks/useBackendHealth", () => ({
  useBackendHealth: () => ({
    health: {
      ok: true,
      timestamp: new Date().toISOString(),
      memory: {
        level: "nominal",
        signals: ["headroom-healthy"],
        totalRamGb: 8,
        freeRamGb: 4,
        usedRamGb: 4,
        freeRatio: 0.5,
        thresholds: {
          constrainedFreeMb: 3072,
          criticalFreeMb: 1536,
          constrainedFreeRatio: 0.22,
          criticalFreeRatio: 0.12,
        },
        ceiling: {
          ceilingMb: 5800,
          overCeiling: false,
          checkedAt: new Date().toISOString(),
          cacheMs: 2000,
          lastError: null,
        },
      },
    },
    loading: false,
    error: null,
    memoryLevel: "nominal",
    memorySignals: ["headroom-healthy"],
  }),
}));

jest.mock("@/components/MissionSurfaceLinks", () => ({
  MissionSurfaceLinks: () => <div data-testid="mission-surface-links" />,
}));

jest.mock("@/components/ops/OpsLaneLinks", () => ({
  OpsLaneLinks: () => <div data-testid="ops-lane-links" />,
}));

jest.mock("@/lib/api/heliophysics-proxy", () => ({
  fetchOpsCommandMetrics: jest.fn(() => new Promise(() => {})),
  queueOpsCommand: jest.fn(async () => ({
    job: {
      jobId: "job-1",
    },
  })),
  planDeepSeekSafeCommand: jest.fn(async () => ({
    proposal: {
      commandPreview: "echo ok",
      plan: {
        reason: "safe",
        confidence: 0.9,
        risk: "low",
      },
    },
    approval: {
      token: "token-1",
    },
  })),
  executeDeepSeekSafeCommand: jest.fn(async () => ({
    execution: {
      ok: true,
      commandPreview: "echo ok",
    },
  })),
}));

describe("DevHud internal feature", () => {
  it("renders expected readiness score from milestone data", () => {
    render(<DevHud />);

    expect(screen.getByTestId("readiness-score")).toHaveTextContent("88%");
    expect(screen.getByRole("heading", { name: /GAUSS AURORA/i })).toBeInTheDocument();
    expect(screen.getByText(/Sovereign Intelligence v0.6/i)).toBeInTheDocument();
  });

  it("progresses audit timeline and writes completion log", () => {
    jest.useFakeTimers();
    render(<DevHud />);

    expect(screen.getByLabelText("audit-running")).toBeInTheDocument();
    expect(screen.getByTestId("audit-logs")).toHaveTextContent("GAUSS_KERNEL_READY");

    for (let step = 0; step < 6; step += 1) {
      act(() => {
        jest.advanceTimersByTime(850);
      });
    }

    expect(screen.getByTestId("audit-logs")).toHaveTextContent("AUDIT_COMPLETE: 88% READINESS");
    expect(screen.getByLabelText("audit-complete")).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("logs sync/deploy actions when controls are used", () => {
    render(<DevHud />);
    fireEvent.click(screen.getByRole("button", { name: /sync node/i }));
    fireEvent.click(screen.getByRole("button", { name: /system ready|initiate shielding/i }));

    const logs = screen.getByTestId("audit-logs");
    expect(logs).toHaveTextContent("NODE_SYNC_TRIGGERED");
    expect(logs).toHaveTextContent("SYSTEM_READY_CONFIRMED");
  });

  it("accepts terminal commands for local operator redundancy", async () => {
    render(<DevHud />);

    fireEvent.change(screen.getByLabelText(/operator command/i), {
      target: { value: "status" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByTestId("audit-logs")).toHaveTextContent("backend=healthy");
  });
});
