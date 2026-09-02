import { defineConfig, devices } from "@playwright/test";

import {
  getLocalStackStatus,
  loadLocalEnvironment,
  requireFictionalEmail,
  requireLiteralLoopbackOrigin,
  requireLocalOrigin,
  requireLocalPassword,
  validateLocalStack,
} from "./scripts/local-auth-config.mjs";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

loadLocalEnvironment();
requireLocalOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const localStatus = getLocalStackStatus();
const localSettings = validateLocalStack(process.env, localStatus);
requireFictionalEmail(process.env.CLOXA_LOCAL_MANAGER_EMAIL);
requireLocalPassword(
  process.env.CLOXA_LOCAL_MANAGER_PASSWORD,
  "CLOXA_LOCAL_MANAGER_PASSWORD",
);
requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
);
requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
);

process.env.CLOXA_SITE_URL = baseURL;
process.env.NEXT_PUBLIC_SUPABASE_URL = localSettings.supabaseUrl;
process.env.CLOXA_LOCAL_MAILPIT_URL = requireLiteralLoopbackOrigin(
  localStatus.MAILPIT_URL ?? localStatus.INBUCKET_URL,
  "Mailpit URL",
);
// Playwright 1.62.1 otherwise captures form values in failure-only aria snapshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./apps/web/e2e",
  globalSetup: "./apps/web/e2e/local.setup.mts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  preserveOutput: "never",
  workers: 2,
  use: {
    baseURL,
    // Passwords, Auth cookies and email links must not be stored in test artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testIgnore: /local-auth\.spec\.mts/u,
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @cloxa/web dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      CLOXA_SITE_URL: baseURL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSettings.publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: localSettings.supabaseUrl,
      SUPABASE_SECRET_KEY: localSettings.secretKey,
    },
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 120_000,
    url: baseURL,
  },
});
