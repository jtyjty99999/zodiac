import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.ZODIAC_E2E_PORT ?? 3107);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev -p ${PORT}`,
    url: BASE_URL,
    // Reuse a manually started dev server when it is already listening.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ZODIAC_SCHEDULER: "off" },
  },
});
