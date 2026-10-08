import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: {
    command: "pnpm exec vite --port 4173 --host 127.0.0.1",
    port: 4173,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
