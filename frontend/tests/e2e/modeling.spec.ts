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

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("starter-example-firstOrder").click();
  await page.getByTestId("simulate-button").click();

  await expect(page.getByTestId("plot-ready")).toBeVisible();
});

test("explains state-space model provenance and matrix dimensions", async ({ page }) => {
  await page.route("**/simulate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        time: [0, 1],
        outputs: { y: [0, 1] },
        metadata: {
          state_mapping: [
            { state_label: "Скорость ротора", block_id: "dc_motor", subsystem_path: ["Привод"] },
            { state_label: "Ток якоря", source: { block_id: "electromagnetic", subsystem_path: ["Привод", "Двигатель"] } },
          ],
        },
        system_analysis: {
          model_type: "continuous_lti",
          state_dimension: 2,
          input_dimension: 1,
          output_dimension: 1,
          state_labels: ["omega", "current"],
          input_blocks: ["step"],
          output_labels: ["y"],
          matrices: {
            A: [[0, 1], [-2, -3]],
            B: [[0], [1]],
            C: [[1, 0]],
            D: [[0]],
          },
          poles: [{ real: -1, imag: 0 }, { real: -2, imag: 0 }],
          modes: [],
          characteristic_polynomial: [1, 3, 2],
          spectral_abscissa: -1,
          stability_degree: 1,
          stability: "stable",
          controllability: { rank: 2, full_rank: true },
          observability: { rank: 2, full_rank: true },
        },
        quality_metrics: {},
        warnings: [],
        validation_errors: [],
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("starter-example-firstOrder").click();
  await page.getByTestId("simulate-button").click();
  await page.getByRole("button", { name: "Матрицы", exact: true }).click();

  const provenance = page.getByTestId("model-provenance");
  await expect(provenance).toContainText("Как собрана модель");
  await expect(page.getByTestId("state-source-x1")).toContainText("dc_motor");
  await expect(page.getByTestId("state-source-x2")).toContainText("Привод / Двигатель");
  await expect(page.getByTestId("matrix-card-A")).toContainText("n × n · динамика состояний");
  await expect(page.getByTestId("matrix-card-D")).toContainText("p × m · прямая передача");
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

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Блоки", exact: true }).click();
  await page.getByTestId("palette-Gain").click();
  await page.getByTestId("palette-Scope").click();
  await page.getByTestId("simulate-button").click();

  await expect(page.getByTestId("diagnostics-panel")).toBeVisible();
  await expect(page.getByTestId("diagnostics-panel")).toContainText(/не подключ[её]н/i);
  await expect(page.locator(".react-flow__node.has-diagnostic-error")).toHaveCount(2);
});

test("links an invalid parameter issue to the affected block", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("starter-example-firstOrder").click();
  await page.getByTestId("node-lag1").dblclick();
  await page.getByTestId("param-lag1-T").fill("0");
  await page.getByTestId("apply-params-button").click();
  await page.getByTestId("simulate-button").click();

  const lagNode = page.locator('.react-flow__node[data-id="lag1"]');
  await expect(page.getByTestId("diagnostics-panel")).toContainText("T должно быть больше 0");
  await expect(lagNode).toHaveClass(/has-diagnostic-error/);

  await page.getByRole("button", { name: /Некорректный параметр/ }).click();
  await expect(lagNode).toHaveClass(/selected/);
});

test("opens the DC motor starter as a compact hierarchical control system", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("starter-example-dcMotorSpeedControl").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.getByTestId("node-dc_motor")).toContainText("u");
  await expect(page.getByTestId("node-dc_motor")).toContainText("omega");

  await page.getByTestId("node-dc_motor").dblclick();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Двигатель DC" })).toBeVisible();
  await expect(page.getByTestId("node-electromagnetic")).toContainText("Якорная цепь и момент");
  await expect(page.getByTestId("node-mechanics")).toContainText("Механическая часть");
  await expect(page.getByTestId("node-back_emf")).toContainText("Противо-ЭДС");

  await page.getByTestId("leave-subsystem-button").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
});

test("builds, connects, and simulates a model from the block library", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route("**/simulate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        time: [0, 1, 2],
        outputs: { y: [0, 0.63, 0.86] },
        metadata: { used_solver: "solve_ivp" },
        validation_errors: []
      })
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Блоки", exact: true }).click();
  await page.getByTestId("palette-StepInput").click();
  await page.getByTestId("palette-FirstOrderLag").click();
  await page.getByTestId("palette-Scope").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByRole("button", { name: "Закрыть боковую панель" }).click();

  const connect = async (sourceLabel: string, targetLabel: string) => {
    const source = page.getByLabel(sourceLabel, { exact: true });
    const target = page.getByLabel(targetLabel, { exact: true });
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };

  await connect("StepInput-1.out output", "FirstOrderLag-2.in input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await connect("FirstOrderLag-2.out output", "Scope-3.in input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  await page.getByTestId("simulate-button").click();
  await expect(page.getByTestId("plot-ready")).toBeVisible();
  await expect(page.getByTestId("diagnostics-panel")).toHaveCount(0);
});

test("the Blocks control opens and closes the focused desktop library", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const library = page.getByTestId("block-library-pane");
  const toggle = page.getByTestId("toggle-block-library");
  await expect(library).not.toBeVisible();
  await expect(library).toHaveAttribute("aria-hidden", "true");

  await toggle.click();
  await expect(library).toBeVisible();
  await expect(library).toHaveAttribute("aria-hidden", "false");

  await page.getByLabel("Закрыть боковую панель").click();
  await expect(library).not.toBeVisible();
  await expect(library).toHaveAttribute("aria-hidden", "true");
});

test("keeps engineering typography readable at 100 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1671, height: 881 });
  await page.goto("/?example=secondOrder", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  const typography = await page.evaluate(() => {
    const metrics = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing typography target: ${selector}`);
      const style = getComputedStyle(element);
      return {
        family: style.fontFamily,
        size: Number.parseFloat(style.fontSize),
        weight: Number.parseInt(style.fontWeight, 10),
      };
    };

    const visibleTextSizes = Array.from(
      document.querySelectorAll("button, a, label, h1, h2, h3, p, small, strong, th, td, input, select"),
    )
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      .filter(Number.isFinite);

    return {
      body: metrics("body"),
      toolbar: metrics(".btn-run"),
      navigation: metrics(".mission-rail__tools button"),
      nodeTitle: metrics(".block-node__title"),
      nodeId: metrics(".block-node__id"),
      minVisibleSize: Math.min(...visibleTextSizes),
      mono600Loaded: document.fonts.check('600 12px "IBM Plex Mono"'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(typography.body.family).toContain("IBM Plex Mono");
  expect(typography.body.size).toBe(16);
  expect(typography.toolbar.size).toBeGreaterThanOrEqual(13);
  expect(typography.navigation.size).toBeGreaterThanOrEqual(14);
  expect(typography.nodeTitle.size).toBeGreaterThanOrEqual(14);
  expect(typography.nodeTitle.weight).toBeGreaterThanOrEqual(600);
  expect(typography.nodeId.size).toBeGreaterThanOrEqual(12);
  expect(typography.minVisibleSize).toBeGreaterThanOrEqual(11);
  expect(typography.mono600Loaded).toBe(true);
  expect(typography.horizontalOverflow).toBe(false);
});
