import { defineConfig } from "@playwright/test";

// Deliberately separate from native/local-auth configs; no global setup or services.
export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: /ux-(polish|responsive|workspace)\.spec\.mts/,
  workers: 1,
  outputDir: "output/playwright/ux-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3174",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node scripts/ux-preview.mjs",
    url: "http://127.0.0.1:3174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
