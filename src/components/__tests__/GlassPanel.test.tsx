// @ts-nocheck
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { loadOrbitComponent, renderWithPropVariants } from "./orbit-test-utils";

const GlassPanel = loadOrbitComponent("GlassPanel", [
  "../orbit/GlassPanel",
  "../ORBIT/GlassPanel",
  "../ui/GlassPanel",
  "../GlassPanel",
]);

const describeIfPresent = GlassPanel ? describe : describe.skip;

describeIfPresent("GlassPanel", () => {
  test("renders children content", () => {
    render(
      <GlassPanel>
        <div data-testid="child-content">panel-body</div>
      </GlassPanel>,
    );

    expect(screen.getByTestId("child-content")).toHaveTextContent("panel-body");
  });

  test("accepts custom className without crashing", () => {
    const { container } = render(
      <GlassPanel className="custom-glass-panel">
        <span>custom-class-check</span>
      </GlassPanel>,
    );

    expect(container.textContent).toContain("custom-class-check");
  });

  test("handles empty/null props gracefully", () => {
    expect(() =>
      renderWithPropVariants(GlassPanel, [
        {},
        { children: null },
        { className: "", children: null },
      ]),
    ).not.toThrow();
  });
});
