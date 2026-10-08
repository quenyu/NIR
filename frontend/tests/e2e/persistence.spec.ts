import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const importedProject = {
  format: "nir-dynamics-project",
  version: 1,
  metadata: {
    title: "Тестовый проект",
    exported_at: "2026-07-07T12:00:00.000Z",
    generator: "playwright"
  },
  diagram: {
    blocks: [
      {
        id: "step1",
        type: "StepInput",
        parameters: { amplitude: 2, t0: 0 },
        input_ports: [],
        output_ports: ["out"]
      },
      {
        id: "scope1",
        type: "Scope",
        parameters: { label: "y" },
        input_ports: ["in"],
        output_ports: []
      }
    ],
    connections: [
      {
        from_block: "step1",
        from_port: "out",
        to_block: "scope1",
        to_port: "in"
      }
    ]
  },
  layout: {
    positions: {
      step1: { x: 120, y: 140 },
      scope1: { x: 430, y: 140 }
    },
    viewport: { x: 10, y: 20, zoom: 1 }
  },
  simulation: {
    solver: "rk4",
    t_start: 0,
    t_end: 8,
    dt: 0.02
  }
};

test("imports a project and restores diagram and simulation settings", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("project-file-input").setInputFiles({
    name: "test-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedProject), "utf-8")
  });

  await expect(page.getByTestId("diagram-stats")).toContainText("2 блока");
  await expect(page.getByTestId("diagram-stats")).toContainText("1 связь");
  await page.getByRole("button", { name: "Расчёт", exact: true }).click();
  await expect(page.getByTestId("solver-select")).toHaveValue("rk4");
  await expect(page.getByTestId("project-info")).toContainText("Тестовый проект");
});

test("exports a versioned project JSON", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-firstOrder").click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("save-project-button").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^diagram_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const parsed = JSON.parse(await readFile(path!, "utf-8")) as typeof importedProject;
  expect(parsed.format).toBe("nir-dynamics-project");
  expect(parsed.version).toBe(1);
  expect(parsed.diagram.blocks.length).toBeGreaterThan(0);
  expect(parsed.layout.positions).toBeTruthy();
  expect(parsed.simulation.solver).toBe("solve_ivp");
});

test("rejects malformed project files without replacing the current diagram", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-example-firstOrder").click();
  await expect(page.getByTestId("diagram-stats")).toContainText("3 блока");

  const malformed = structuredClone(importedProject);
  malformed.diagram.connections[0].to_block = "missing-block";

  await page.getByTestId("project-file-input").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(malformed), "utf-8")
  });

  await expect(page.getByTestId("diagnostics-panel")).toContainText("не найден");
  await expect(page.getByTestId("diagram-stats")).toContainText("3 блока");
});
