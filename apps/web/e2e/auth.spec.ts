import { expect, test } from "@playwright/test";

import { collectConsoleErrors, loginWithEmailCode } from "./support";

/**
 * Employee login with an emailed code, read from the local Mailpit.
 * Needs the local Supabase stack and `pnpm --filter @cloxa/web dev:seed`.
 */
const EMPLOYEE = "jan@demo.test";

test("employee logs in with an email code, cannot enter /manage, and logs out", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);

  await loginWithEmailCode(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/app$/);

  // An employee has no business in /manage and is sent back to /app.
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/app$/);

  // Logout lives in the account sheet, opened from the name in the sidebar (the Ik tab on phones).
  await page.getByRole("button", { name: "Jan J.", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Afmelden", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);

  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => /^(sb-|cx_)/.test(cookie.name))).toEqual([]);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  expect(consoleErrors).toEqual([]);
});
