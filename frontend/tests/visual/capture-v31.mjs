import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const outputDir = resolve("..", "artifacts", "v34-signal-modules-qa");
await mkdir(outputDir, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
const distDir = resolve("dist");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const filePath = pathname === "/" ? resolve(distDir, "index.html") : resolve(distDir, `.${pathname}`);
  if (!filePath.startsWith(distDir)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    const contentType = filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".js")
        ? "text/javascript"
        : filePath.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    response.writeHead(200, { "content-type": contentType }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Unable to start the visual QA server.");
}

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
  ],
});

const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
await page.route("**/simulate", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      time: [0, 1, 2, 3, 4, 5, 6],
      outputs: { y: [0, 0.64, 0.87, 0.95, 0.98, 0.994, 0.998] },
      metadata: { used_solver: "solve_ivp" },
      validation_errors: [],
    }),
  });
});
await page.goto(`http://127.0.0.1:${address.port}/?example=compactSubsystemChain`, {
  waitUntil: "domcontentloaded",
});
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });
await page.waitForTimeout(500);

const geometry = await page.locator(".react-flow__node").evaluateAll((nodes) =>
  nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-id"),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      transform: node.style.transform,
    };
  }),
);
const viewportTransform = await page.locator(".react-flow__viewport").evaluate((element) => getComputedStyle(element).transform);

for (let index = 1; index < geometry.length; index += 1) {
  if (geometry[index].left <= geometry[index - 1].right) {
    throw new Error(`${geometry[index - 1].id} overlaps ${geometry[index].id}`);
  }
}

await page.screenshot({ path: resolve(outputDir, "01-five-subsystems.png") });
await page.getByTestId("toggle-block-library").click();
await page.getByTestId("block-library-pane").waitFor({ state: "visible" });
await page.waitForTimeout(350);
await page.screenshot({ path: resolve(outputDir, "07-block-library.png") });
await page.locator(".library-pane__toggle").click();
await page.locator(".react-flow__node").nth(2).click();
await page.getByRole("complementary", { name: "Инспектор модели" }).waitFor();
await page.locator(".react-flow__node").nth(2).screenshot({ path: resolve(outputDir, "03-selected-node.png") });
await page.getByRole("complementary", { name: "Инспектор модели" }).screenshot({ path: resolve(outputDir, "04-inspector.png") });
await page.screenshot({ path: resolve(outputDir, "02-inspector-footer.png") });

await page.goto(`http://127.0.0.1:${address.port}/?example=firstOrder`, {
  waitUntil: "domcontentloaded",
});
const firstOrderNode = page.getByTestId("node-lag1");
await firstOrderNode.waitFor({ state: "visible" });
const safeZones = await firstOrderNode.evaluate((node) => {
  const nodeRect = node.getBoundingClientRect();
  const title = node.querySelector(".block-node__title")?.getBoundingClientRect();
  const meta = node.querySelector(".block-node__meta")?.getBoundingClientRect();
  return {
    nodeLeft: nodeRect.left,
    nodeRight: nodeRect.right,
    titleLeft: title?.left ?? 0,
    titleRight: title?.right ?? 0,
    metaLeft: meta?.left ?? 0,
    metaRight: meta?.right ?? 0,
  };
});
if (
  safeZones.titleLeft < safeZones.nodeLeft + 20
  || safeZones.titleRight > safeZones.nodeRight - 20
  || safeZones.metaLeft < safeZones.nodeLeft + 20
  || safeZones.metaRight > safeZones.nodeRight - 20
) {
  throw new Error(`Node content leaves its safe zone: ${JSON.stringify(safeZones)}`);
}
await firstOrderNode.screenshot({ path: resolve(outputDir, "05-first-order-safe-zones.png") });

await page.goto(`http://127.0.0.1:${address.port}/?example=hierarchicalClosedLoop`, {
  waitUntil: "domcontentloaded",
});
await page.locator(".react-flow__node").nth(4).waitFor({ state: "visible" });
await page.screenshot({ path: resolve(outputDir, "06-hierarchical-feedback.png") });

await page.goto(`http://127.0.0.1:${address.port}/`, {
  waitUntil: "domcontentloaded",
});
await page.locator(".canvas-starter, .canvas-empty-state").first().waitFor({ state: "visible" });
await page.screenshot({ path: resolve(outputDir, "08-empty-workspace.png") });

await page.goto(`http://127.0.0.1:${address.port}/?example=firstOrder`, {
  waitUntil: "domcontentloaded",
});
await page.getByTestId("simulate-button").click();
await page.getByTestId("plot-ready").waitFor({ state: "visible" });
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outputDir, "09-results-dock.png") });

await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(`http://127.0.0.1:${address.port}/?example=compactSubsystemChain`, {
  waitUntil: "domcontentloaded",
});
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });
await page.waitForTimeout(350);
const responsiveTransform = await page.locator(".react-flow__viewport").evaluate((element) => getComputedStyle(element).transform);
const responsiveScale = Number.parseFloat(responsiveTransform.match(/^matrix\(([^,]+)/)?.[1] ?? "0");
if (responsiveScale < 0.85) {
  throw new Error(`Responsive graph scale is too small: ${responsiveScale}`);
}
await page.screenshot({ path: resolve(outputDir, "10-responsive-1366.png") });

console.log(JSON.stringify({ viewportTransform, responsiveTransform, responsiveScale, geometry }, null, 2));
await browser.close();
await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
