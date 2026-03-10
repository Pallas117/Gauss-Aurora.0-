import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import ORBITTemplate from "@/components/orbit/ORBITTemplate";

jest.mock("@/components/orbit/template/OrbitSceneViewport", () => ({
  OrbitSceneViewport: ({ onFatal }: { onFatal?: () => void }) => (
    <button type="button" data-testid="orbit-scene-stub" onClick={() => onFatal?.()}>
      orbit scene stub
    </button>
  ),
}));

describe("ORBITTemplate", () => {
  it("renders the split shell with a live scene viewport when WebGL is available", async () => {
    render(<ORBITTemplate />);

    expect(await screen.findByTestId("orbit-template-root")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /space domain awareness/i })).toBeInTheDocument();
    expect(screen.getByTestId("orbit-scene-stub")).toBeInTheDocument();
    expect(screen.getByTestId("orbit-telemetry-panel")).toBeInTheDocument();
    expect(screen.getByTestId("orbit-primitives-panel")).toBeInTheDocument();
    expect(screen.getByTestId("orbit-hud")).toBeInTheDocument();
  });

  it("falls back to the safe DOM shell when the scene reports a fatal renderer error", async () => {
    render(<ORBITTemplate />);

    fireEvent.click(await screen.findByTestId("orbit-scene-stub"));

    expect(await screen.findByTestId("orbit-fallback-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("orbit-generate-instance"));

    expect(await screen.findByTestId("orbit-probability-modal")).toBeInTheDocument();
    expect(screen.getByText(/selected by minimum distance to conjunction risk/i)).toBeInTheDocument();
  });
});
