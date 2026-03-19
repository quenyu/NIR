import { expect, test } from "@playwright/test";

test("loads an example and displays a plot after simulation", async ({ page }) => {
  await page.route("**/simulate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        time: [0, 1, 2, 3],
        outputs: { y: [0, 0.8, 1.2, 1.4] },
        metadata: { used_solver: "solve_ivp" },
        validation_errors: []
      })
    });
  });

  await page.goto("/");
  await page.getByTestId("load-example-firstOrder").click();
  await page.getByTestId("simulate-button").click();

  await expect(page.getByTestId("plot-ready")).toBeVisible();
});

test("shows validation errors for an invalid diagram", async ({ page }) => {
  await page.route("**/simulate", async (route) => {
    const payload = route.request().postDataJSON() as {
      diagram: { connections: unknown[] };
    };
    if (payload.diagram.connections.length === 0) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          time: [],
          outputs: {},
          metadata: { requested_solver: "solve_ivp" },
          validation_errors: ["Обязательный вход 'in' блока 'gain1' не подключен."]
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        time: [0, 1],
        outputs: { y: [0, 0] },
        metadata: {},
        validation_errors: []
      })
    });
  });

  await page.goto("/");
  await page.getByTestId("clear-button").click();
  await page.getByTestId("palette-Gain").click();
  await page.getByTestId("palette-Scope").click();
  await page.getByTestId("simulate-button").click();

  await expect(page.getByTestId("error-panel")).toBeVisible();
  await expect(page.getByTestId("error-panel")).toContainText("не подключен");
});
