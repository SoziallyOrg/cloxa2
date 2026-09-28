import { execSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the local Supabase stack. Needs `pnpm db:start` and
 * `pnpm --filter @cloxa/web dev:seed`; see apps/web/e2e. Not in CI yet.
 */
const PORT = 3100;
// localhost, not 127.0.0.1: browsers accept `Secure` cookies over http only there.
const BASE_URL = `http://localhost:${PORT}`;

function localSupabase(): Record<string, string> {
  const status = JSON.parse(
    execSync("supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Record<string, string>;
  return {
    NEXT_PUBLIC_SUPABASE_URL: status["API_URL"] ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status["PUBLISHABLE_KEY"] ?? "",
    SUPABASE_SECRET_KEY: status["SECRET_KEY"] ?? "",
  };
}

// Fresh per run: nothing here outlives the test server.
const secret = () => randomBytes(32).toString("base64url");
const exportSigningKey = () =>
  Buffer.from(
    generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }),
  ).toString("base64");

// The app trusts `x-real-ip` (CLOXA_PROXY_MODE=vercel), as behind the real
// platform. One random address per run (198.18.0.0/15, reserved for testing)
// keeps repeated runs out of each other's per-IP limiter buckets.
const [a = 0, b = 0] = randomBytes(2);
const clientIp = `198.${18 + (a & 1)}.${b}.${(a >> 1) + 1}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    extraHTTPHeaders: { "x-real-ip": clientIp },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build (`next build && next start`): exercises the real CSP
    // and Secure cookies, and does not clash with a `next dev` that may already
    // run for this app. Docker builds the standalone server instead (see
    // next.config.ts), which pnpm symlinks make unusable on Windows.
    command: `pnpm --filter @cloxa/web build && pnpm --filter @cloxa/web exec next start --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...localSupabase(),
      CLOXA_SITE_URL: BASE_URL,
      CLOXA_PROXY_MODE: "vercel",
      AUTH_HASH_PEPPER: secret(),
      FLOW_COOKIE_SECRET: secret(),
      EXPORT_SIGNING_KEY: exportSigningKey(),
      EXPORT_SIGNING_KEY_ID: "e2e",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
    },
  },
});
