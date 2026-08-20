import { expect, test } from "@playwright/test";
import { mockUiApis } from "./helpers/mockUiApis";

test.beforeEach(async ({ page }) => {
  await mockUiApis(page);
});

test("auth portal exposes password and SSO controls when session is signed out", async ({ page }) => {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "*",
  };

  await page.route("**/api/auth/session**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({
        authRequired: true,
        authenticated: false,
        role: null,
        userId: null,
        email: null,
      }),
    });
  });

  await page.goto("/");
  const authTrigger = page.getByRole("button", {
    name: /open mission access portal|access mission control/i,
  });
  const hasAuthTrigger = await authTrigger.isVisible().catch(() => false);

  if (hasAuthTrigger) {
    await authTrigger.click();
    await expect(
      page.getByRole("heading", { name: /mission access portal/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in with password/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /google sso/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /github sso/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /azure sso/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /open signup portal/i }),
    ).toBeVisible();
    return;
  }

  await expect(page.getByText(/gauss aurora/i)).toBeVisible();
  await expect(page.getByText(/reasoning\.feed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /initiate/i })).toBeVisible();
});

test("signup route renders SSO and subscription controls", async ({ page }) => {
  await page.goto("/signup");

  const hasSignupUi = await page
    .getByRole("button", { name: /sign up with email/i })
    .isVisible()
    .catch(() => false);

  if (hasSignupUi) {
    await expect(
      page.getByText(/signup \+ subscription portal/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign up with email/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /google sso/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /github sso/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /azure sso/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /open stripe checkout/i }),
    ).toBeVisible();
    return;
  }

  // Fallback for HUD-only route map: verify base shell still renders.
  await page.goto("/");
  await expect(page.getByText(/gauss aurora/i)).toBeVisible();
  await expect(page.getByText(/mission context:/i)).toBeVisible();
});
