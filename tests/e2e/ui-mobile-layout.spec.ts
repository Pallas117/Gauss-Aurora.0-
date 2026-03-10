import { expect, test } from "@playwright/test";
import { mockUiApis } from "./helpers/mockUiApis";

test.use({
  viewport: { width: 390, height: 844 },
});

test.beforeEach(async ({ page }) => {
  await mockUiApis(page);
});

test("mobile: command shell controls remain usable at 390x844", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/command$/);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Viewport not available");

  const commandHeading = page.getByRole("heading", { name: /command snapshot/i });
  const telemetryHeading = page.getByRole("heading", { name: /live 5s telemetry stream/i });
  const sourceHealth = page.getByRole("heading", { name: /source health/i });
  const sdaLink = page.getByRole("link", { name: /^sda/i });
  const sendFeedback = page.getByRole("button", { name: /send feedback/i }).first();

  await expect(commandHeading).toBeVisible();
  await expect(telemetryHeading).toBeVisible();
  await expect(sourceHealth).toBeVisible();
  await expect(sdaLink).toBeVisible();
  await expect(sendFeedback).toBeVisible();

  const criticalLocators = [commandHeading, telemetryHeading, sourceHealth, sdaLink, sendFeedback];

  for (const locator of criticalLocators) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }

  await sdaLink.click();
  await expect(page).toHaveURL(/\/sda$/);
  await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible();

  await page.getByRole("link", { name: /^command/i }).click();
  await expect(page).toHaveURL(/\/command$/);
});
