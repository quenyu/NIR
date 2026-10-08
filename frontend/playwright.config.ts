import { defineConfig } from "@playwright/test";

const externalChromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const externalChromiumArgs = (() => {
  try {
    const parsed = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
})();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: externalChromiumExecutable
      ? { executablePath: externalChromiumExecutable, args: externalChromiumArgs }
      : undefined,
  },
  webServer: {
    command: "npm run dev -- --port 4173 --host 127.0.0.1",
    port: 4173,
    timeout: 120_000,
    reuseExistingServer: true
  }
});
