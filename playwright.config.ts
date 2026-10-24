import { defineConfig, devices } from "@playwright/test";

/**
 * One smoke test against the production build (`pnpm build` first). The
 * agent endpoint is mocked, so it needs no API keys and costs nothing.
 */

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
