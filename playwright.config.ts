import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against a local dev server in demo mode on the test rail, or against a
 * deployed instance when E2E_BASE_URL is set (for example the production URL).
 */
const PORT = 3100;
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: remote ? 120_000 : 30_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: remote ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Production runs send the test-only bypass for the per-address workspace limit, if one is set.
    extraHTTPHeaders: process.env.E2E_BYPASS_TOKEN ? { "x-signoff-e2e": process.env.E2E_BYPASS_TOKEN } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: remote
    ? undefined
    : {
        command: `rm -rf data/e2e.db && pnpm next dev --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          APP_URL: `http://localhost:${PORT}`,
          DATABASE_URL: "file:./data/e2e.db",
          BRAINTREE_ENVIRONMENT: "fake",
          // E2E_LIVE_AI=1 uses the model from .env.local instead of the scripted checker.
          ...(process.env.E2E_LIVE_AI ? {} : { AI_PROVIDER: "scripted" }),
          DEMO_MODE: "true",
          NEXT_DIST_DIR: ".next-e2e",
        },
      },
});
