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
  await expect(page).toHaveURL(/\/sda$/);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Viewport not available");

  const sdaHeading = page.getByRole("heading", { name: /sda visualization/i });
  const metricsTab = page.getByRole("tab", { name: /metrics & science/i });
  const missionControlButton = page.getByRole("button", { name: /login for mission control|open mission control/i });

  await expect(sdaHeading).toBeVisible();
  await expect(metricsTab).toBeVisible();
  await expect(missionControlButton).toBeVisible();

  const criticalLocators = [sdaHeading, metricsTab, missionControlButton];

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

  await missionControlButton.click();
  await expect(page).toHaveURL(/\/command$/);
  const primaryNav = page.getByRole("navigation", { name: /primary/i });
  const commandLink = primaryNav.getByRole("link", { name: "Command C2", exact: true });
  await expect(commandLink).toBeVisible();
});
