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

  await page.goto("/heliophysics");

  await page.getByRole("button", { name: /open login portal/i }).click();
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
});

test("signup route renders SSO and subscription controls", async ({ page }) => {
  await page.goto("/signup");

  await expect(
    page.getByRole("heading", { name: /signup \+ subscription portal/i }),
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
});
