import { expect, test } from "@playwright/test";

test("runs an experiment, shows running state and supports export", async ({ page }) => {
  let experimentRequestCount = 0;
  await page.route("**/experiments/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenarios: [
          {
            slug: "second_order_oscillator",
            title: "Колебательное звено второго порядка",
            description: "Тестовый сценарий",
            default_dt: 0.01,
            default_t_end: 6,
            default_dt_values: [0.2, 0.1, 0.05, 0.02, 0.01, 0.005],
            default_benchmark_repetitions: 5,
            default_benchmark_warmup: 1,
            parameter_block_id: "plant",
            parameter_name: "zeta",
            parameter_nominal: 0.55,
            default_parameter_values: [0.3, 0.45, 0.55, 0.7, 0.9]
          }
        ],
        solvers: ["rk4", "solve_ivp"]
      })
    });
  });

  await page.route("**/experiments/run", async (route) => {
    experimentRequestCount += 1;
    await page.waitForTimeout(250);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario: {
          slug: "second_order_oscillator",
          title: "Колебательное звено второго порядка",
          description: "Тестовый сценарий",
          requested_dt: 0.01,
          requested_t_end: 6,
          selected_solvers: ["rk4", "solve_ivp"]
        },
        environment: {
          generated_at_utc: "2026-03-21T12:00:00+00:00",
          python_version: "3.13.12",
          platform: "Windows"
        },
        timeseries: {
          time: [0, 1, 2, 3],
          analytic: [0, 0.5, 0.9, 1.0],
          rk4: [0, 0.51, 0.91, 1.01],
          solve_ivp: [0, 0.49, 0.89, 0.99]
        },
        accuracy_rows: [
          {
            solver: "rk4",
            dt: 0.01,
            max_abs_error: 1e-4,
            rmse: 8e-5,
            final_value_error: 1e-4
          },
          {
            solver: "solve_ivp",
            dt: 0.01,
            max_abs_error: 6e-5,
            rmse: 4e-5,
            final_value_error: 2e-5
          }
        ],
        solver_comparison_rows: [
          {
            max_abs_diff: 8e-5,
            rmse_diff: 5e-5,
            final_value_diff: 4e-5
          }
        ],
        dt_sweep_rows: [
          {
            solver: "rk4",
            dt: 0.1,
            max_abs_error: 1e-2,
            rmse: 9e-3,
            final_value_error: 8e-3
          },
          {
            solver: "rk4",
            dt: 0.01,
            max_abs_error: 1e-4,
            rmse: 8e-5,
            final_value_error: 7e-5
          },
          {
            solver: "solve_ivp",
            dt: 0.1,
            max_abs_error: 5e-3,
            rmse: 4e-3,
            final_value_error: 4e-3
          },
          {
            solver: "solve_ivp",
            dt: 0.01,
            max_abs_error: 6e-5,
            rmse: 4e-5,
            final_value_error: 2e-5
          }
        ],
        benchmark_summary_rows: [
          {
            solver: "rk4",
            mean_ms: 10,
            median_ms: 9,
            std_ms: 1,
            min_ms: 8,
            max_ms: 12,
            repetitions: 5
          },
          {
            solver: "solve_ivp",
            mean_ms: 7,
            median_ms: 6.5,
            std_ms: 0.7,
            min_ms: 6,
            max_ms: 8,
            repetitions: 5
          }
        ],
        benchmark_samples: [
          { solver: "rk4", iteration: 1, duration_ms: 8.5 },
          { solver: "rk4", iteration: 2, duration_ms: 9.1 },
          { solver: "rk4", iteration: 3, duration_ms: 9.7 },
          { solver: "rk4", iteration: 4, duration_ms: 10.2 },
          { solver: "rk4", iteration: 5, duration_ms: 9.3 },
          { solver: "solve_ivp", iteration: 1, duration_ms: 6.2 },
          { solver: "solve_ivp", iteration: 2, duration_ms: 6.7 },
          { solver: "solve_ivp", iteration: 3, duration_ms: 6.4 },
          { solver: "solve_ivp", iteration: 4, duration_ms: 7.0 },
          { solver: "solve_ivp", iteration: 5, duration_ms: 6.1 }
        ],
        parameter_sweep_rows: [],
        monte_carlo_rows: [],
        robust_summary: null,
        warnings: [],
        interpretation_notes: [
          "Для solve_ivp параметр dt в текущем API задаёт главным образом сетку вывода, а не внутренний адаптивный шаг интегратора.",
          "Benchmark относится к текущей машине и текущему окружению, поэтому абсолютные времена нужно трактовать локально."
        ]
      })
    });
  });

  await page.goto("/experiments");
  await page.getByTestId("experiments-run-button").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByTestId("experiments-running-indicator")).toBeVisible();
  await expect(page.getByTestId("experiments-run-button")).toBeDisabled();

  await expect(page.getByTestId("experiments-summary-cards")).toBeVisible();
  await expect(page.getByTestId("experiments-transition-plot")).toBeVisible();
  await expect(page.getByTestId("experiments-comparison-table")).toBeVisible();
  expect(experimentRequestCount).toBe(1);

  await expect(page.getByTestId("experiments-accuracy-table")).toHaveCount(0);
  await expect(page.getByTestId("experiments-benchmark-panel")).toHaveCount(0);

  await page.getByTestId("experiments-result-tab-accuracy").click();
  await expect(page.getByTestId("experiments-accuracy-table")).toBeVisible();
  await expect(page.getByTestId("experiments-dt-sweep-plot")).toBeVisible();

  await page.getByTestId("experiments-result-tab-benchmark").click();
  await expect(page.getByTestId("experiments-benchmark-panel")).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("experiments-download-json").click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe("experiment-second_order_oscillator-result.json");

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("experiments-download-csv").click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe("experiment-second_order_oscillator-summary.csv");
});
