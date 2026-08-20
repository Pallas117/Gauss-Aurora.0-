import { expect, test } from "@playwright/test";
import { mockUiApis } from "./helpers/mockUiApis";

test.beforeEach(async ({ page }) => {
  await mockUiApis(page);
});

test("smoke: public SDA analysis renders without login", async ({ page }) => {
  await page.route(/\/api\/auth\/session/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authRequired: true,
        authenticated: false,
        role: null,
        clearance: null,
        userId: null,
        email: null,
        emailVerified: false,
      }),
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/sda$/);
  await expect(page.getByText(/public sda analysis/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /login for mission control/i })).toBeVisible();
});

test("smoke: command shell routes, auth modal, and feedback actions", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sda$/);

  await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible();
  await expect(page.getByText(/public sda analysis/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /login for mission control|open mission control/i })).toBeVisible();

  const missionControlButton = page.getByRole("button", { name: /login for mission control|open mission control/i });
  await missionControlButton.click();
  const authHeading = page.getByRole("heading", { name: /mission access portal/i });
  if (await authHeading.count()) {
    await expect(authHeading).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(page).toHaveURL(/\/command$/);
    const primaryNav = page.getByRole("navigation", { name: /primary/i });
    await expect(primaryNav.getByRole("link", { name: "SDA HUD", exact: true })).toBeVisible();
    await expect(primaryNav.getByRole("link", { name: "Systems Infra", exact: true })).toBeVisible();
    await expect(primaryNav.getByRole("link", { name: "Intel RAG", exact: true })).toBeVisible();
    await page.goto("/sda");
  }

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
  await expect(page.getByTestId("gauss-shell-content")).toBeVisible();

  await page.goto("/command");
  const feedbackMessage = page.getByPlaceholder(
    /describe the issue, desired behavior, or workflow friction/i,
  );
  await feedbackMessage.fill("Command shell navigation and cards are responsive.");
  const sendFeedback = page.getByRole("button", { name: /send feedback/i }).first();
  await expect(sendFeedback).toBeEnabled();
  const feedbackResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/feedback$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await sendFeedback.click();
  const feedbackResponse = await feedbackResponsePromise;
  expect(feedbackResponse.status()).toBe(201);
  await expect(feedbackMessage).toHaveValue("");
});
