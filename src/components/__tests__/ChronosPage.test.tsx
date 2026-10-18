import { render, screen } from "@testing-library/react";
import ChronosPage from "@/pages/ChronosPage";
import type { BackendHealthResponse, BackendMemoryHealth } from "@/lib/types/space-weather";

let mockHealth: BackendHealthResponse | null = null;

jest.mock("@/hooks/useBackendHealth", () => ({
  useBackendHealth: () => ({ health: mockHealth, error: null }),
}));

jest.mock("@/hooks/useMissionSnapshot", () => ({
  useMissionSnapshot: () => ({ snapshot: null, session: null, pollingPaused: false }),
}));

jest.mock("@/components/ops/OpsLaneLinks", () => ({
  OpsLaneLinks: () => <div data-testid="ops-lane-links" />,
}));

// The backend memory health has no planner mode (backend/runtime/memory-pressure.ts toMemoryGovernorHealth).
function backendHealth(memory: Partial<BackendMemoryHealth> = {}): BackendHealthResponse {
  return {
    ok: true,
    timestamp: "2026-03-07T12:00:00.000Z",
    memory: {
      level: "nominal",
      freeMb: 2048,
      suspendedSubsystems: [],
      svgLiteForced: false,
      ...memory,
    },
  };
}

describe("ChronosPage", () => {
  it("shows the DeepSeek mode as unknown when backend health does not report it", () => {
    mockHealth = backendHealth();
    render(<ChronosPage />);

    expect(screen.getByText("Memory headroom: 2048 MB free · DeepSeek unknown")).toBeInTheDocument();
  });

  it("shows the DeepSeek mode backend health reports", () => {
    mockHealth = backendHealth({ deepseekMode: "manual" });
    render(<ChronosPage />);

    expect(screen.getByText("Memory headroom: 2048 MB free · DeepSeek manual")).toBeInTheDocument();
  });
});
