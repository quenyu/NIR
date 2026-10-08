import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const outputDir = path.resolve("..", "artifacts", "redesign-final");

test.beforeAll(async () => {
  await mkdir(outputDir, { recursive: true });
});

test("captures readable typography at 100 percent zoom", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1671, height: 881 });
  await page.goto("/?example=secondOrder", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByTestId("toggle-block-library").click();
  await page.getByTestId("simulate-button").click();
  await expect(page.getByTestId("plot-ready")).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outputDir, "00-typography-1671x881.png") });
});

test("captures the redesigned engineering workbench", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?example=dcMotorSpeedControl", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, "01-editor-1920x1080.png") });

  await page.getByTestId("node-speed_pid").click();
  await expect(page.getByRole("complementary", { name: "Инспектор модели" })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "02-editor-inspector-1920x1080.png") });

  await page.getByTestId("simulate-button").click();
  await expect(page.getByTestId("plot-ready")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, "03-editor-results-1920x1080.png") });

  await page.getByTestId("scope-tab-state-space").click();
  await expect(page.locator(".matrix-card")).toHaveCount(4);
  await expect(page.locator(".matrix-table")).toHaveCount(4);
  await expect(page.getByTestId("model-verification")).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "04-editor-matrices-1920x1080.png") });
  await page.getByTestId("scope-tab-plot").click();

  await page.getByLabel("Закрыть инспектор").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "fit view" }).click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDir, "05-editor-1440x900.png") });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "fit view" }).click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDir, "06-editor-1024x768.png") });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "fit view" }).click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDir, "07-editor-mobile-375x812.png") });
});

test("captures the experiment workbench", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/experiments", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("experiments-run-button")).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "08-experiments-setup-1920x1080.png") });

  await page.getByTestId("experiments-run-button").click();
  await expect(page.getByTestId("experiments-summary-cards")).toBeVisible({ timeout: 150_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, "09-experiments-results-1920x1080.png") });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDir, "10-experiments-mobile-375x812.png") });
});
