import { expect, test } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Owner: opens the activity log, sees recent entries, and runs the
 * integrity check. Reuses the TOTP enrolment pattern from `manager.spec.ts`
 * / `manager-journey.spec.ts`. `owner-e2e@demo.test` is a dedicated seeded
 * owner account (not the human `eigenaar@demo.test`), so `resetFactors`
 * first is safe and the spec is idempotent.
 */
const OWNER = "owner-e2e@demo.test";

test("owner reads the activity log and verifies the integrity chains", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const consoleErrors = collectConsoleErrors(page);
  await resetFactors(OWNER);

  await loginWithEmailCode(page, OWNER);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await page.getByRole("button", { name: "Start met instellen" }).click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });

  // 1. The log itself, from the "Meer" link.
  await page.goto("/manage/meer");
  await page.getByRole("link", { name: "Activiteitenlog" }).click();
  await expect(page).toHaveURL(/\/manage\/meer\/audit$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Activiteitenlog");
  // The owner's own TOTP enrolment and this navigation already wrote audit
  // rows (memberships/logins aren't the log's business, but the seeded
  // organization has plenty from dev-seed and earlier specs).
  await expect(page.getByRole("listitem").first()).toBeVisible();

  // 2. Integrity check.
  await page.getByRole("button", { name: "Controleer integriteit" }).click();
  await expect(page.getByRole("status")).toContainText(
    "zijn onveranderd sinds ze werden opgeslagen",
    { timeout: 15_000 },
  );

  expect(consoleErrors).toEqual([]);
});
