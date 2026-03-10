// @ts-nocheck
import React from "react";
import { cleanup, render } from "@testing-library/react";

export function loadOrbitComponent(exportName: string, candidates: string[]) {
  const runtimeRequire =
    typeof require === "function" ? require : (0, eval)("require");

  for (const modulePath of candidates) {
    try {
      const mod = runtimeRequire(modulePath);
      if (mod && mod[exportName]) {
        return mod[exportName];
      }
      if (mod && mod.default) {
        // Fall back to default export if named export is not available.
        return mod.default;
      }
    } catch {
      // Try next candidate path.
    }
  }
  return null;
}

export function renderWithPropVariants(
  Component: any,
  propVariants: Record<string, unknown>[],
) {
  let lastError: unknown = null;

  for (const props of propVariants) {
    try {
      const rendered = render(React.createElement(Component, props));
      return { ...rendered, usedProps: props };
    } catch (error) {
      lastError = error;
      cleanup();
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Unable to render component with provided prop variants.");
}

export function textIncludesNumericValue(
  textContent: string | null | undefined,
  value: number,
) {
  if (!textContent) {
    return false;
  }
  const fixed2 = value.toFixed(2);
  const fixed1 = value.toFixed(1);
  const fixed0 = value.toFixed(0);
  return (
    textContent.includes(fixed2) ||
    textContent.includes(fixed1) ||
    textContent.includes(fixed0) ||
    textContent.includes(String(value))
  );
}
