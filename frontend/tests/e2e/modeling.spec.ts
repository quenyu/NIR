import { expect, test } from "@playwright/test";
import { connect, last, simulate } from "./helpers";

// Every test here talks to the real backend; the only route interception is the
// "server unreachable" case and one request body mutation to provoke a 422.

test("builds a first-order model from the library and matches 1 - e^(-t)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("palette-StepInput").click();
  await page.getByTestId("palette-FirstOrderLag").click();
  await page.getByTestId("palette-Scope").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  await connect(page, "StepInput-1.out output", "FirstOrderLag-2.in input");
  await connect(page, "FirstOrderLag-2.out output", "Scope-3.in input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  const { status, body } = await simulate(page);
  expect(status).toBe(200);
  const y = Object.values(body.outputs)[0] as number[];
  // K = 1, T = 1, t_end = 6: y(6) = 1 - e^-6; RK45 with rtol 1e-8.
  expect(last(y)).toBeCloseTo(1 - Math.exp(-6), 6);
  await expect(page.getByTestId("plot-ready")).toBeVisible();

  await page.getByTestId("scope-tab-analysis").click();
  await expect(page.getByTestId("system-stability")).toContainText("Асимптотически устойчива");
});

test("closed loop stabilises an unstable plant: 3/(s+2), y(inf) = 1.5", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-unstablePlantFeedback").click();

  const { body } = await simulate(page);
  expect(body.system_analysis.stability).toBe("stable");
  expect(body.system_analysis.poles[0].real).toBeCloseTo(-2, 9);
  expect(body.quality_metrics.y.target_value).toBeCloseTo(1.5, 9);

  await page.getByTestId("scope-tab-analysis").click();
  await expect(page.locator(".scope-analysis")).toContainText("1.5");
});

test("a multi-level model compiles and simulates through subsystems", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-compactSubsystemChain").click();

  const { status, body } = await simulate(page);
  expect(status).toBe(200);
  const mapping = body.metadata.provenance.state_mapping as Array<{ subsystem_path: string[] }>;
  expect(mapping.some((entry) => entry.subsystem_path.length > 0)).toBe(true);

  const subsystem = page.locator('[data-block-type="Subsystem"]').first();
  await subsystem.dblclick();
  await expect(page.getByRole("button", { name: /На уровень выше/ })).toBeVisible();
  await page.getByRole("button", { name: /На уровень выше/ }).click();
  await expect(page.locator('[data-block-type="Subsystem"]').first()).toBeVisible();
});

test("a server-side diagram error is shown as text", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-firstOrder").click();
  // Drop one connection on the way to the server: the real backend answers 422.
  await page.route("**/simulate", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    payload.diagram.connections = payload.diagram.connections.slice(1);
    await route.continue({ postData: JSON.stringify(payload) });
  });

  const { status, body } = await simulate(page);
  expect(status).toBe(422);
  expect(body.code).toBe("diagram_invalid");
  const panel = page.getByTestId("diagnostics-panel");
  await expect(panel).toContainText("не подключен");
  await expect(panel).not.toContainText("[object Object]");
});

test("an unreachable server is reported, not swallowed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-firstOrder").click();
  await page.route("**/simulate", (route) => route.abort("connectionrefused"));
  await page.getByTestId("simulate-button").click();
  await expect(page.getByTestId("diagnostics-panel")).toContainText("Сервер моделирования недоступен");
});

test("an RK4 step outside the method's stability region is refused with a suggested dt", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-secondOrder").click();
  await page.route("**/simulate", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    await route.continue({ postData: JSON.stringify({ ...payload, solver: "rk4", dt: 2.0 }) });
  });
  const { status, body } = await simulate(page);
  expect(status).toBe(422);
  expect(body.code).toBe("solver_settings");
  await expect(page.getByTestId("diagnostics-panel")).toContainText("Уменьшите dt");
});
