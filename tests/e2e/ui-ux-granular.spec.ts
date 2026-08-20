/**
 * Granular UI/UX test suite: one describe block per major area for clear per-route reporting.
 * Run via orchestrator (test:sweep or test:ui:granular). Uses mockUiApis; no live backend required.
 */
import { expect, test } from "@playwright/test";
import { mockUiApis } from "./helpers/mockUiApis";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", err => console.error("PAGE_ERROR:", err.message));
  page.on("console", msg => {
    if (msg.type() === "error") console.error("BROWSER_ERROR:", msg.text());
  });
  await mockUiApis(page);
});

test.describe("Command", () => {
  test("loads command shell and shows snapshot, telemetry, source health, nav links", async ({
    page,
  }) => {
    await page.goto("/command", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/command$/);
    await expect(page.getByRole("heading", { name: /command snapshot/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /live 5s telemetry stream/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /source health/i })).toBeVisible({ timeout: 10_000 });
    const nav = page.getByRole("navigation", { name: /primary/i });
    await expect(nav.getByRole("link", { name: /sda/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(nav.getByRole("link", { name: /intel/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("feedback input and send button are usable", async ({ page }) => {
    await page.goto("/command", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/command$/);
    await expect(page.getByRole("heading", { name: /command snapshot/i })).toBeVisible({ timeout: 15_000 });
    const feedbackMessage = page.getByPlaceholder(
      /describe the issue, desired behavior, or workflow friction/i,
    );
    await expect(feedbackMessage).toBeVisible({ timeout: 10_000 });
    await feedbackMessage.fill("Granular test feedback.");
    await expect(page.getByRole("button", { name: /send feedback/i }).first()).toBeEnabled({ timeout: 5_000 });
  });
});

test.describe("SDA", () => {
  test("loads SDA page and shows visualization heading", async ({ page }) => {
    await page.goto("/sda");
    await page.waitForLoadState("domcontentloaded");
    const hasSdaHeading = await page
      .getByRole("heading", { name: /sda visualization/i })
      .isVisible()
      .catch(() => false);
    if (hasSdaHeading) {
      await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible();
      return;
    }
    await expect(page.getByText(/gauss aurora/i)).toBeVisible();
  });

  test("shows HUD and Metrics tabs", async ({ page }) => {
    await page.goto("/sda");
    const hasSdaTabs = await page
      .getByRole("tab", { name: /^hud$/i })
      .isVisible()
      .catch(() => false);
    if (hasSdaTabs) {
      await expect(page.getByRole("tab", { name: /^hud$/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /metrics & science/i })).toBeVisible();
      return;
    }
    await expect(page.getByText(/reasoning\.feed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /initiate/i })).toBeVisible();
  });

  test("visualizes debris and satellite catalog data on SDA", async ({ page }) => {
    await page.goto("/sda", { waitUntil: "domcontentloaded" });
    const hasSdaHeading = await page
      .getByRole("heading", { name: /sda visualization/i })
      .isVisible()
      .catch(() => false);
    if (!hasSdaHeading) {
      await expect(page.getByText(/gauss aurora/i)).toBeVisible();
      await expect(page.getByText(/mission context:/i)).toBeVisible();
      return;
    }
    await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible();

    const svgScene = page.getByRole("img", {
      name: /project gauss mission surface/i,
    });
    const liteMap = page.getByRole("img", { name: /simplified sda map/i });
    if (await svgScene.count()) {
      await expect(svgScene.first()).toBeVisible();
    } else if (await liteMap.count()) {
      await expect(liteMap).toBeVisible();
    } else {
      await expect(page.getByText(/public sda analysis/i)).toBeVisible();
    }

    await page.getByRole("tab", { name: /metrics & science/i }).click();
    await expect(page.getByRole("heading", { name: /feed state/i })).toBeVisible();

    await expect(page.getByRole("heading", { name: /satellite & object data/i })).toBeVisible();
    const highValueHeading = page.getByText(/high-value \(\d+\)/i);
    if (await highValueHeading.count()) {
      await expect(highValueHeading).toBeVisible();
      await expect(page.getByText(/unidentified \(\d+\)/i)).toBeVisible();
      await expect(page.getByText("SAT-A")).toBeVisible();
      await expect(page.getByText("OBJ-X")).toBeVisible();
    } else {
      await expect(page.getByText(/no satellite catalog data yet/i)).toBeVisible();
    }
  });
});

test.describe("Heliophysics", () => {
  test("loads mission console and shows main heading", async ({ page }) => {
    await page.goto("/heliophysics");
    await expect(page).toHaveURL(/\/heliophysics$/);
    await expect(
      page.getByRole("heading", { name: /gauss aurora mission console/i }),
    ).toBeVisible();
  });
});

test.describe("Intel", () => {
  test("loads intel page and shows RAG + Threat Intelligence", async ({ page }) => {
    await page.goto("/intel");
    await expect(page).toHaveURL(/\/intel$/);
    await expect(
      page.getByRole("heading", { name: /rag \+ threat intelligence/i }),
    ).toBeVisible();
  });

  test("shows Mission Access card", async ({ page }) => {
    await page.goto("/intel");
    await expect(page.getByRole("heading", { name: /mission access/i })).toBeVisible();
  });
});

test.describe("Systems", () => {
  test("loads systems overview and shows main heading", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/systems", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/systems$/);
    await expect(
      page.getByRole("heading", { name: /systems overview/i }),
    ).toBeVisible({ timeout: 25_000 });
  });

  test("shows Automation, Chronos, Turing lane links", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/systems", { waitUntil: "domcontentloaded" });
    const opsLaneLinks = page.getByRole("region", { name: /operations lane links/i });
    await expect(opsLaneLinks.getByRole("link", { name: /automation/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(opsLaneLinks.getByRole("link", { name: /chronos/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(opsLaneLinks.getByRole("link", { name: /turing/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Orbit", () => {
  test("loads orbit shell and core panels", async ({ page }) => {
    await page.goto("/orbit", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/orbit$/);
    await expect(page.getByTestId("orbit-template-root")).toBeVisible();
    await expect(page.getByRole("heading", { name: /space domain awareness/i })).toBeVisible();
    await expect(page.getByTestId("orbit-canvas-panel")).toBeVisible();
    await expect(page.getByTestId("orbit-telemetry-panel")).toBeVisible();
    await expect(page.getByTestId("orbit-primitives-panel")).toBeVisible();

    await expect(
      page.locator('[data-testid="orbit-scene-viewport"], [data-testid="orbit-fallback-panel"]').first(),
    ).toBeVisible();

    const fallback = page.getByTestId("orbit-fallback-panel");
    if (await fallback.isVisible().catch(() => false)) {
      await page.getByTestId("orbit-generate-instance").click();
      await expect(page.getByTestId("orbit-probability-modal")).toBeVisible();
      await expect(page.getByText(/selected by minimum distance to conjunction risk/i)).toBeVisible();
      return;
    }

    await expect(page.getByTestId("orbit-scene-viewport")).toBeVisible();
    await expect(page.getByTestId("orbit-hud")).toBeVisible();
  });
});

test.describe("Staff portal", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/ops/audit/summary**", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          totals: { pass: 10, warn: 0, fail: 0, skip: 2 },
          check_count: 12,
        }),
      });
    });
  });

  test("loads staff portal and shows roadmap content for operator session", async ({
    page,
  }) => {
    await page.goto("/staff/portal");
    await expect(page).toHaveURL(/\/staff\/portal$/);
    await expect(
      page
        .getByRole("heading", { name: /internal staff portal|next implementations|last full audit|login.*activation/i })
        .first(),
    ).toBeVisible();
  });
});

test.describe("Auth / session", () => {
  test("login portal opens and shows password and SSO controls", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/heliophysics", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /open login portal|manage session/i }).click({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /mission access portal/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /sign in with password|google sso|sign out/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });
});

test.describe("Boot flow", () => {
  test("app shell becomes visible after boot", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/sda", { waitUntil: "domcontentloaded" });
    const hasSdaHeading = await page
      .getByRole("heading", { name: /sda visualization/i })
      .isVisible()
      .catch(() => false);
    if (hasSdaHeading) {
      await expect(page.getByRole("heading", { name: /sda visualization/i })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/public sda stays live off the space-domain store/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("button", { name: /login for mission control|open mission control/i }),
      ).toBeVisible({ timeout: 10_000 });
      return;
    }
    await expect(page.getByText(/gauss aurora/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/reasoning\.feed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /initiate/i })).toBeVisible({ timeout: 10_000 });
  });
});
