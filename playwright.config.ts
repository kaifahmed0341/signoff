import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf data/e2e.db && pnpm next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_URL: `http://localhost:${PORT}`,
      DATABASE_URL: "file:./data/e2e.db",
      BRAINTREE_ENVIRONMENT: "fake",
      AI_PROVIDER: "scripted",
      OPERATOR_PASSCODE: "signoff-demo",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
