import { expect, test } from "@playwright/test";
import { simulate } from "./helpers";

// The opening sequence, the model sphere and the animation setting. The interface
// is calm by default: no intro and no decorative animation until the user turns
// them on from the menu. The system "reduce motion" preference is emulated to
// show that the in-app setting decides, not the operating system.

test.describe("opening sequence", () => {
  test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" });

  test("is off by default, runs the real start-up checks once turned on", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("simulate-button")).toBeVisible();
    await expect(page.getByTestId("intro")).toHaveCount(0);
    await page.getByLabel("Дополнительные команды").click();
    // Both switches keep the menu open.
    await page.getByTestId("motion-toggle").click();
    await page.getByTestId("intro-toggle").click();
    await expect(page.getByTestId("intro-toggle")).toContainText("вкл");
    await page.goto("/");
    const intro = page.getByTestId("intro");
    await expect(intro).toBeVisible();
    await expect(intro).toContainText("Соединение с сервером моделирования");
    // The checks answer from the real backend; the first one names the endpoint it hit.
    await expect(intro).toContainText("/health", { timeout: 10_000 });
    await page.getByTestId("intro-skip").click();
    await expect(intro).toHaveCount(0);
    await expect(page.getByTestId("simulate-button")).toBeVisible();
  });
});

test("the analysis tab shows the model sphere next to the pole map", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-unstablePlantFeedback").click();
  await simulate(page);
  await page.getByTestId("scope-tab-analysis").click();
  const sphere = page.getByTestId("pole-sphere");
  await expect(sphere).toBeVisible();
  await expect(sphere.locator("canvas")).toHaveCount(1);
  // One real pole at -2: stable, so nothing is drawn in red.
  await expect(sphere.locator("canvas")).toHaveAttribute("aria-label", "Сфера модели: 1 полюс");
});

test("animation is off by default and can be turned on and back off from the menu", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/motion-off/);
  await page.getByLabel("Дополнительные команды").click();
  await page.getByTestId("motion-toggle").click();
  await expect(html).not.toHaveClass(/motion-off/);
  await page.reload();
  await expect(html).not.toHaveClass(/motion-off/);
  await page.getByLabel("Дополнительные команды").click();
  await page.getByTestId("motion-toggle").click();
  await expect(html).toHaveClass(/motion-off/);
});
