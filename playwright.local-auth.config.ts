import { defineConfig, devices } from "@playwright/test";

import {
  loadLocalEnvironment,
  requireLiteralLoopbackOrigin,
  requireLocalOrigin,
  requireLocalPassword,
} from "./scripts/local-auth-config.mjs";
import { validateLocalOperatorEnvironment } from "./scripts/local-manager-mfa-recovery.mjs";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const useProductionServer = process.env.CLOXA_E2E_PRODUCTION === "1";

loadLocalEnvironment();
requireLocalOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const localSettings = await validateLocalOperatorEnvironment();
const localStatus = localSettings.stackStatus;
requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
);
requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
);

for (const key of Object.keys(process.env)) {
  if (!(key in localSettings.dockerEnvironment)) delete process.env[key];
}
Object.assign(process.env, localSettings.dockerEnvironment);
process.env.CLOXA_SITE_URL = baseURL;
process.env.NEXT_PUBLIC_SUPABASE_URL = localSettings.supabaseUrl;
process.env.CLOXA_LOCAL_MAILPIT_URL = requireLiteralLoopbackOrigin(
  localStatus.MAILPIT_URL ?? localStatus.INBUCKET_URL,
  "Mailpit URL",
);
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: /local-auth\.spec\.mts/u,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  preserveOutput: "never",
  workers: 1,
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium-desktop-local-auth",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @cloxa/web ${
      useProductionServer ? "start" : "dev"
    } --hostname 127.0.0.1 --port ${port}`,
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
