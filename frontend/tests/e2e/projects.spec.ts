import { expect, test, type Page } from "@playwright/test";
import { BACKEND } from "./helpers";

async function createOnServer(page: Page, title: string): Promise<{ id: string; version: number }> {
  await page.getByTestId("save-server-project-button").click();
  const modal = page.getByTestId("server-projects-modal");
  await expect(modal).toBeVisible();
  await modal.getByLabel("Название нового проекта").fill(title);
  const created = page.waitForResponse((r) => r.url().endsWith("/projects") && r.request().method() === "POST");
  await modal.getByRole("button", { name: "Создать на сервере" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  await modal.getByRole("button", { name: "Закрыть" }).click();
  return response.json();
}

async function openFromServer(page: Page, title: string): Promise<void> {
  await page.locator('summary[aria-label="Дополнительные команды"]').click();
  await page.getByTestId("open-server-projects-button").click();
  const modal = page.getByTestId("server-projects-modal");
  await modal.locator("article", { hasText: title }).getByRole("button", { name: "Открыть" }).click();
  await expect(modal).toBeHidden();
}

function nodeTransform(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => (element as HTMLElement).style.transform);
}

test("a project saved on the server opens again after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-unstablePlantFeedback").click();
  const title = `Контур ${Date.now()}`;
  await createOnServer(page, title);

  await page.reload();
  await openFromServer(page, title);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  await expect(page.getByTestId("node-plant")).toContainText("1/(s − 1)");
});

test("block positions inside a subsystem survive saving from that level", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-compactSubsystemChain").click();
  const subsystem = page.locator('[data-block-type="Subsystem"]').first();
  const subsystemId = await subsystem.getAttribute("data-testid");
  await subsystem.dblclick();
  await expect(page.getByRole("button", { name: /На уровень выше/ })).toBeVisible();
  await page.waitForTimeout(600); // the level opens with an animated fitView

  const inner = page.locator(".react-flow__node").first();
  const innerId = (await inner.getAttribute("data-id"))!;
  const before = await nodeTransform(page, innerId);
  const box = (await inner.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2 + 4);
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 96, { steps: 12 });
  await page.mouse.up();
  const moved = await nodeTransform(page, innerId);
  expect(moved).not.toBe(before);

  // Saved while the subsystem level is still open.
  const title = `Иерархия ${Date.now()}`;
  await createOnServer(page, title);

  await page.reload();
  await openFromServer(page, title);
  await page.getByTestId(subsystemId!).dblclick();
  await expect(page.getByRole("button", { name: /На уровень выше/ })).toBeVisible();
  expect(await nodeTransform(page, innerId)).toBe(moved);
});

test("saving over a newer server version reports the conflict", async ({ page, request }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-firstOrder").click();
  const title = `Конфликт ${Date.now()}`;
  const created = await createOnServer(page, title);

  // Another session updates the project first.
  const record = await (await request.get(`${BACKEND}/projects/${created.id}`)).json();
  const update = await request.put(`${BACKEND}/projects/${created.id}`, {
    data: { title, payload: record.payload, expected_version: created.version },
  });
  expect(update.status()).toBe(200);

  const save = page.waitForResponse((r) => r.url().includes(`/projects/${created.id}`) && r.request().method() === "PUT");
  await page.getByTestId("save-server-project-button").click();
  expect((await save).status()).toBe(409);
  await expect(page.getByTestId("canvas-notice")).toContainText("изменён в другой сессии");
});
