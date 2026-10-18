import { render, screen } from "@testing-library/react";
import { MhdEffectsScene } from "@/components/heliophysics/MhdEffectsScene";
import { MHD_FIXTURE_SCHEMA } from "@/lib/mhd-fixture";

const baseProps = {
  canonicalPoint: null,
  pressureCompression: 1,
  beltIntensity: 0.5,
  reconnectionStrength: 0.4,
};

describe("MhdEffectsScene", () => {
  it("labels the SVG as a schematic, not a simulation", () => {
    render(<MhdEffectsScene {...baseProps} layers={{}} stale />);

    expect(screen.getByRole("img", { name: "Schematic magnetohydrodynamic view STALE" })).toBeInTheDocument();
  });

  it("shows the reconnection legend only while the reconnection line is drawn", () => {
    const { rerender } = render(<MhdEffectsScene {...baseProps} layers={{ mmsReconnection: true }} />);
    expect(screen.getByText("RECONNECTION · Bz")).toBeInTheDocument();

    rerender(<MhdEffectsScene {...baseProps} layers={{ mmsReconnection: false }} />);
    expect(screen.queryByText("RECONNECTION · Bz")).not.toBeInTheDocument();
  });

  it("names the fixture schema in low-power mode", () => {
    render(<MhdEffectsScene {...baseProps} layers={{}} lowPower />);

    expect(screen.getByText(`SVG LITE · ${MHD_FIXTURE_SCHEMA}`)).toBeInTheDocument();
  });
});
