import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryGraphExplorer } from "@/components/MemoryGraphExplorer";

describe("MemoryGraphExplorer", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders a bounded graph and provenance after the memory service responds", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        state: "nominal",
        nodes: [
          { id: "doc:1", label: "Edge Intelligence", type: "document", sourcePath: "research/memory-inbox/edge.md", truthState: "approved", sourceSha256: "abc123" },
          { id: "entity:1", label: "Jetson Orin NX", type: "hardware", truthState: "observed" },
        ],
        edges: [{ source: "doc:1", target: "entity:1", relation: "mentions", confidence: 0.9 }],
        truncated: false,
      }),
    } as Response);
    Object.defineProperty(global, "fetch", { configurable: true, writable: true, value: fetchMock });

    render(<MemoryGraphExplorer />);
    await waitFor(() => expect(screen.getAllByText(/Edge Intelligence/i).length).toBeGreaterThan(0));
    expect(screen.getByTestId("memory-graph-explorer")).toBeInTheDocument();
    expect(screen.getByText(/graph depth capped at 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Jetson Orin NX/i));
    expect(screen.getByText(/hardware · Jetson Orin NX/i)).toBeInTheDocument();
  });
});
