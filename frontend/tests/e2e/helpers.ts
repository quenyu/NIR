import { expect, type Page } from "@playwright/test";

export const BACKEND = "http://127.0.0.1:8765";

/** Click "run" and return the server's JSON response to /simulate. */
export async function simulate(page: Page): Promise<{ status: number; body: Record<string, any> }> {
  const response = page.waitForResponse((r) => r.url().endsWith("/simulate"));
  await page.getByTestId("simulate-button").click();
  const r = await response;
  return { status: r.status(), body: await r.json() };
}

export async function connect(page: Page, sourceLabel: string, targetLabel: string): Promise<void> {
  const sourceBox = await page.getByLabel(sourceLabel, { exact: true }).boundingBox();
  const targetBox = await page.getByLabel(targetLabel, { exact: true }).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
  await page.mouse.up();
}

export function last(values: number[]): number {
  return values[values.length - 1];
}
