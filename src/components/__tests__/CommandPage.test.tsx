import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CommandPage from "@/pages/CommandPage";
import {
  approveOpsDelegationTask,
  planOpsCommandWithModel,
  queueOpsCommand,
} from "@/lib/api/heliophysics-proxy";

jest.mock("@/lib/api/heliophysics-proxy", () => ({
  fetchOpsCommandJob: jest.fn(async () => ({
    jobId: "job-test-1",
    commandType: "log-health-check",
    payload: {},
    source: "manual",
    status: "succeeded",
    simulate: false,
    idempotencyKey: null,
    requestedBy: "u1",
    powerConstrained: false,
    heavyCommand: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: {},
    error: null,
  })),
  fetchOpsCommandMetrics: jest.fn(async () => ({
    metrics: {
      queue_depth: 0,
      planner_latency_avg_ms: 50,
      execution_total: 1,
      execution_succeeded_total: 1,
      battery_throttle_hits_total: 0,
    },
    planner_circuit: {
      open: false,
      open_until: null,
      consecutive_failures: 0,
    },
  })),
  approveOpsDelegationTask: jest.fn(async () => ({
    result: {
      summary: "Approved mission action queued.",
    },
  })),
  rejectOpsDelegationTask: jest.fn(async () => ({
    result: {
      summary: "Rejected mission action.",
    },
  })),
  planOpsCommandWithModel: jest.fn(),
  queueOpsCommand: jest.fn(),
}));

jest.mock("@/components/heliophysics/FeedbackPanel", () => ({
  FeedbackPanel: () => <div data-testid="feedback-panel-mock">FeedbackPanel Mock</div>,
}));

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => ({
    session: {
      authRequired: true,
      authenticated: true,
      role: "operator",
      clearance: "mission",
      userId: "u1",
      email: "operator@example.com",
      emailVerified: true,
    },
    snapshot: {
      canonicalLatest: {
        timestamp: new Date().toISOString(),
        source: "fusion",
        rho: 7,
        velocity: { x: -420, y: 18, z: -9, magnitude: 445 },
        magneticField: { x: 2, y: -1, z: -5.5, bt: 6.2 },
        electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
        solarWind: { speed: 445, density: 7, dynamicPressure: 2.8 },
        indices: { kp: 4, dst: -48 },
        coupling: { newell: 12000, epsilon: 810000 },
        propagation: { l1DelaySeconds: 1600, etaEarthArrival: new Date().toISOString() },
        alerts: { stormTier: "warning", reason: "mock" },
        quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
        uncertainty: {
          speed: { lower: 430, upper: 460, sigma: 8 },
          density: { lower: 6.5, upper: 7.5, sigma: 0.3 },
          bz: { lower: -6, upper: -4, sigma: 0.5 },
        },
      },
      sourceStatus: [
        { source: "noaa-swpc", lastSeen: new Date().toISOString(), latencySeconds: 12, healthy: true },
      ],
      threatSummary: {
        timestamp: new Date().toISOString(),
        source: "memory",
        lookbackMs: 1800000,
        count: 10,
        gate: {
          is_urgent: true,
          action: "TRIGGER_LLM",
          confidence: 90,
          reason: "mock",
          flux_proxy: 0.1,
          flux_latest: 0.1,
          flux_mean: 0.1,
          flux_max: 0.1,
        },
        summary: {
          threat_count: 1,
          actionable_threat_count: 1,
          top_threat_type: "solar_flare",
          top_threat_score: 0.8,
          top_recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
        },
        threats: [
          {
            id: "t1",
            type: "solar_flare",
            probability: 0.8,
            confidence_interval: [0.7, 0.9],
            factors: [{ name: "complexity", weight: 0.5, value: 4, contribution: 0.9 }],
            composite_score: 0.81,
            actionable: true,
            recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
          },
        ],
      },
      timestamp: new Date().toISOString(),
    },
    loading: false,
    error: null,
    pollingPaused: false,
    refresh: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

jest.mock("@/hooks/useOpsCommandSnapshot", () => ({
  useOpsCommandSnapshot: () => ({
    data: {
      workers: [
        {
          id: "command-planner",
          lane: "runtime",
          enabled: true,
          approval: "operator-gate",
          state: "idle",
          lastRunAt: new Date().toISOString(),
          lastResult: {
            workerId: "command-planner",
            status: "completed",
            summary: "Planner held steady.",
            autoExecuted: false,
            queuedApproval: false,
            touchedSystems: ["planner"],
            nextTasks: [],
            artifacts: [],
          },
        },
        {
          id: "safe-executor",
          lane: "runtime",
          enabled: true,
          approval: "safe-auto",
          state: "idle",
          lastRunAt: new Date().toISOString(),
          lastResult: {
            workerId: "safe-executor",
            status: "completed",
            summary: "Health check captured.",
            autoExecuted: true,
            queuedApproval: false,
            touchedSystems: ["health"],
            nextTasks: [],
            artifacts: [],
          },
        },
      ],
      queuedApprovals: [
        {
          taskId: "approval-1",
          workerId: "command-planner",
          summary: "Review SSA warning and trigger a nowcast response.",
          risk: "medium",
          createdAt: new Date().toISOString(),
        },
      ],
      brokerPolicy: {
        memoryLevel: "nominal",
        externalModelMode: "auto",
        autoSafeOps: true,
      },
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useMissionCoreSnapshot", () => ({
  useMissionCoreSnapshot: () => ({
    data: {
      passes: [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSolarWind5s", () => ({
  useSolarWind5s: () => ({
    points: [
      {
        timestamp: new Date().toISOString(),
        solarWind: { speed: 445.2, density: 7.5, dynamicPressure: 2.8 },
        magneticField: { z: -5.4 },
      },
    ],
    latest: null,
    loading: false,
    error: null,
    source: "polling",
  }),
}));

jest.mock("@/hooks/useThreatSummary", () => ({
  useThreatSummary: () => ({
    data: {
      gate: { action: "TRIGGER_LLM" },
      threats: [
        {
          id: "t1",
          type: "solar_flare",
          recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
          composite_score: 0.81,
          probability: 0.8,
        },
      ],
    },
    loading: false,
    error: null,
  }),
}));

jest.mock("@/hooks/usePowerProfile", () => ({
  usePowerProfile: () => ({
    profile: "balanced",
    isLowPower: false,
    isConstraintDetected: false,
  }),
}));

describe("CommandPage", () => {
  it("renders command snapshot and telemetry panels", async () => {
    render(
      <MemoryRouter>
        <CommandPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /command snapshot/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /live 5s telemetry stream/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /source health/i })).toBeInTheDocument();
    expect(screen.getByText(/storm warning/i)).toBeInTheDocument();
    expect(screen.getAllByText(/IMMEDIATE SOLAR_FLARE EVASION/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("feedback-panel-mock")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /worker mesh/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /approval queue/i })).toBeInTheDocument();
  });

  it("runs plan preview and queues simulate/execute from approved plan", async () => {
    const planMock = planOpsCommandWithModel as jest.Mock;
    const queueMock = queueOpsCommand as jest.Mock;
    planMock.mockResolvedValueOnce({
      command: {
        command_type: "log-health-check",
        payload: { note: "run diagnostics" },
        reason: "telemetry anomaly suspected",
        confidence: 0.91,
      },
      log: { id: "log-1" },
    });
    queueMock.mockResolvedValue({
      job: {
        jobId: "job-queued-1",
        commandType: "log-health-check",
        payload: { note: "run diagnostics" },
        source: "manual",
        status: "planned",
        simulate: true,
        idempotencyKey: "test-key",
        requestedBy: "u1",
        powerConstrained: false,
        heavyCommand: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
      },
      deduped: false,
      log: { id: "log-2" },
    });

    render(
      <MemoryRouter>
        <CommandPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /plan preview/i }));
    await waitFor(() => {
      expect(planMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/command: log-health-check/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /simulate/i }));
    await waitFor(() => {
      expect(queueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          command_type: "log-health-check",
          execute: true,
          simulate: true,
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /approve \+ execute/i }));
    await waitFor(() => {
      expect(queueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          command_type: "log-health-check",
          execute: true,
          simulate: false,
        }),
      );
    });
  });

  it("approves queued worker proposals from the command page", async () => {
    render(
      <MemoryRouter>
        <CommandPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /approve/i })[0]!);
    await waitFor(() => {
      expect(approveOpsDelegationTask).toHaveBeenCalledWith({ taskId: "approval-1" });
    });
  });
});
