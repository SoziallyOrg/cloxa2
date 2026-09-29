import { expect, test } from "@playwright/test";

import { collectConsoleErrors } from "./support";

/**
 * The public entry points render under the production CSP without a single
 * console error (a blocked inline script or style would show up here).
 */
const PAGES = [
  // The public website.
  { path: "/", lands: /\/$/ },
  { path: "/aanvragen", lands: /\/aanvragen$/ },
  { path: "/aanvragen/verstuurd", lands: /\/aanvragen\/verstuurd$/ },
  { path: "/privacy", lands: /\/privacy$/ },
  { path: "/voorwaarden", lands: /\/voorwaarden$/ },
  { path: "/verwerkersovereenkomst", lands: /\/verwerkersovereenkomst$/ },
  { path: "/login", lands: /\/login$/ },
  // A junk token hash is refused before anything is verified.
  { path: "/auth/confirm?token_hash=x&type=email", lands: /\/login\?fout=link$/ },
  // A well-formed one renders the "press to log in" page; GET verifies nothing.
  {
    path: `/auth/confirm?token_hash=${"a".repeat(56)}&type=email`,
    lands: /\/auth\/confirm\?/,
  },
  // Signed out, /app goes to the login page.
  { path: "/app", lands: /\/login$/ },
  // Every UI primitive, with the self-hosted font (CLOXA_PREVIEW=1 in e2e).
  { path: "/preview", lands: /\/preview$/ },
] as const;

for (const { path, lands } of PAGES) {
  test(`${path} loads without console errors under the CSP`, async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const response = await page.goto(path);
    await expect(page).toHaveURL(lands);
    expect(response?.headers()["content-security-policy"]).toMatch(
      /script-src[^;]*'nonce-/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Give late scripts (hydration, chunks) the chance to be refused.
    await page.waitForLoadState("networkidle");
    expect(consoleErrors).toEqual([]);
  });
}
