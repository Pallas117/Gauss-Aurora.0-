import { expect, test } from "@playwright/test";
import { mockUiApis } from "./helpers/mockUiApis";

test.beforeEach(async ({ page }) => {
  await mockUiApis(page);
});

test("smoke: command shell routes, auth modal, and feedback actions", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/command$/);

  await expect(page.getByRole("heading", { name: /command snapshot/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /live 5s telemetry stream/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^sda/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^systems/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^intel/i })).toBeVisible();

  await page.goto("/sda");
  await expect(page).toHaveURL(/\/sda$/);
  await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible();

  await page.goto("/systems");
  await expect(page).toHaveURL(/\/systems$/);
  await expect(page.getByRole("heading", { name: /systems overview/i })).toBeVisible();

  await page.goto("/intel");
  await expect(page).toHaveURL(/\/intel$/);
  await expect(page.getByRole("heading", { name: /rag \+ threat intelligence/i })).toBeVisible();

  await page.getByRole("button", { name: /manage session|open login portal/i }).click();
  await expect(page.getByRole("heading", { name: /mission access portal/i })).toBeVisible();
  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const googleSsoButton = page.getByRole("button", { name: /google sso/i });
  await expect(signOutButton.or(googleSsoButton)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/systems?tab=chronos");
  await expect(page).toHaveURL(/\/systems\?tab=chronos$/);
  await expect(page.getByRole("heading", { name: /runtime diagnostics/i })).toBeVisible();

  await page.goto("/heliophysics");
  await expect(page).toHaveURL(/\/heliophysics$/);
  await expect(page.getByRole("heading", { name: /gauss aurora mission console/i })).toBeVisible();

  await page.goto("/command");
  const feedbackMessage = page.getByPlaceholder(
    /describe the issue, desired behavior, or workflow friction/i,
  );
  await feedbackMessage.fill("Command shell navigation and cards are responsive.");
  const sendFeedback = page.getByRole("button", { name: /send feedback/i }).first();
  await expect(sendFeedback).toBeEnabled();
  await sendFeedback.click();
  await expect(page.getByText(/feedback received/i).first()).toBeVisible();
});
