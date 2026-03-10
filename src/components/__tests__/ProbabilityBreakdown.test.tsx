// @ts-nocheck
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
  loadOrbitComponent,
  renderWithPropVariants,
  textIncludesNumericValue,
} from "./orbit-test-utils";

const probabilityCandidates = [
  "../orbit/ProbabilityBreakdown",
  "../ORBIT/ProbabilityBreakdown",
  "../ui/ProbabilityBreakdown",
  "../ProbabilityBreakdown",
];

const ProbabilityBreakdown = loadOrbitComponent(
  "ProbabilityBreakdown",
  probabilityCandidates,
);

const FactorRow = loadOrbitComponent("FactorRow", probabilityCandidates);

const describeIfPresent = ProbabilityBreakdown ? describe : describe.skip;
const describeFactorIfPresent = FactorRow ? describe : describe.skip;

const SAMPLE_FACTORS = [
  {
    name: "Southward IMF",
    weight: 0.4,
    value: -8.5,
    contribution: 0.88,
    unit: "nT",
  },
  {
    name: "Electric Driver",
    weight: 0.35,
    value: 2.6,
    contribution: 0.74,
    unit: "mV/m",
  },
  {
    name: "Tetrahedron Quality",
    weight: 0.25,
    value: 0.92,
    contribution: 0.92,
  },
];

function renderProbabilityBreakdown(onWhatIfChange = jest.fn()) {
  const baseProbability = 0.73;
  const baseCi = [0.65, 0.81];
  return renderWithPropVariants(ProbabilityBreakdown, [
    {
      probability: baseProbability,
      confidenceInterval: baseCi,
      factors: SAMPLE_FACTORS,
      whatIfValue: baseProbability,
      onWhatIfChange,
    },
    {
      probability: baseProbability,
      confidence_interval: baseCi,
      factors: SAMPLE_FACTORS,
      onWhatIfChange,
    },
    {
      threat: {
        probability: baseProbability,
        confidence_interval: baseCi,
        factors: SAMPLE_FACTORS,
      },
      onWhatIfChange,
      whatIfValue: baseProbability,
    },
    {
      threat: {
        probability: baseProbability,
        confidenceInterval: baseCi,
        factors: SAMPLE_FACTORS,
      },
      onWhatIfChange,
      whatIfValue: baseProbability,
    },
  ]);
}

describeIfPresent("ProbabilityBreakdown", () => {
  test("renders factor contributions correctly", () => {
    const { container } = renderProbabilityBreakdown();
    const text = container.textContent ?? "";

    for (const factor of SAMPLE_FACTORS) {
      expect(text).toContain(factor.name);
      // Accept decimal or percent-style formatting from the UI.
      const hasContribution =
        textIncludesNumericValue(text, factor.contribution) ||
        textIncludesNumericValue(text, factor.contribution * 100);
      expect(hasContribution).toBe(true);
    }
  });

  test("displays composite probability and confidence interval", () => {
    const { container } = renderProbabilityBreakdown();
    const text = container.textContent ?? "";

    expect(textIncludesNumericValue(text, 0.73)).toBe(true);
    expect(textIncludesNumericValue(text, 0.65)).toBe(true);
    expect(textIncludesNumericValue(text, 0.81)).toBe(true);
  });

  test("slider calls onWhatIfChange", () => {
    const onWhatIfChange = jest.fn();
    renderProbabilityBreakdown(onWhatIfChange);

    const sliders = screen.queryAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);

    const slider = sliders[0];
    fireEvent.change(slider, { target: { value: "0.91" } });
    fireEvent.input(slider, { target: { value: "0.91" } });

    expect(onWhatIfChange).toHaveBeenCalled();
  });

  test("handles empty/null props gracefully", () => {
    expect(() =>
      renderWithPropVariants(ProbabilityBreakdown, [
        {},
        { factors: [], onWhatIfChange: jest.fn() },
        { factors: null, threat: null, onWhatIfChange: jest.fn() },
      ]),
    ).not.toThrow();
  });
});

describeFactorIfPresent("FactorRow", () => {
  test("renders one factor row with contribution", () => {
    const factor = SAMPLE_FACTORS[0];
    const { container } = renderWithPropVariants(FactorRow, [
      { factor },
      { name: factor.name, contribution: factor.contribution, weight: factor.weight, value: factor.value },
    ]);
    const text = container.textContent ?? "";

    expect(text).toContain(factor.name);
    const hasContribution =
      textIncludesNumericValue(text, factor.contribution) ||
      textIncludesNumericValue(text, factor.contribution * 100);
    expect(hasContribution).toBe(true);
  });
});
