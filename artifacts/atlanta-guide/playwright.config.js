import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use Replit's supplied Chromium when available, or Playwright's downloaded browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 20_000,
  reporter: "list",
  outputDir: "../../generated-artifacts/atlanta-guide-ui",
  use: {
    // Use the shared preview proxy; the API service and Gemini are not needed.
    baseURL: process.env.ASK_LOCAL_TEST_BASE_URL || "http://localhost:80",
    serviceWorkers: "block",
    launchOptions: { executablePath },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
