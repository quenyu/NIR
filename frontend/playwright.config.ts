import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * End-to-end tests run against the real backend: uvicorn on its own port with a
 * throwaway SQLite database, and the Vite dev server pointed at it.
 *   PYTHON              python executable with the backend dependencies (default "python")
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH   optional Chromium binary
 */
const BACKEND_PORT = 8765;
const FRONTEND_PORT = 4173;
const database = join(tmpdir(), `control-lab-e2e-${Date.now()}.db`);
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    headless: true,
    viewport: { width: 1600, height: 950 },
    launchOptions: chromium ? { executablePath: chromium } : undefined,
  },
  webServer: [
    {
      command: `${process.env.PYTHON ?? "python"} -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      env: { ...process.env, NIR_PROJECT_DB_PATH: database } as Record<string, string>,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --host 127.0.0.1 --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${BACKEND_PORT}` } as Record<string, string>,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
