import { readFile } from "node:fs/promises";

import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Owner: "Uit dienst" for a dedicated employee, who then cannot get in any
 * more; the AVG subject export; "Terug in dienst", after which the employee
 * can log in again. `offboard-e2e@demo.test` is reserved for this spec, and
 * `owner-e2e@demo.test` is a dedicated seeded owner account (not the human
 * `eigenaar@demo.test`), so resetting its factors is safe. A run that failed
 * half-way is repaired by reinstating first.
 */
const OWNER = "owner-e2e@demo.test";
const EMPLOYEE = "offboard-e2e@demo.test";
const EMPLOYEE_NAME = "Otto Uitdiensttest";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function employeeLogin(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginWithEmailCode(page, EMPLOYEE);
  return page;
}

test("owner offboards and reinstates an employee, and downloads the AVG export", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const consoleErrors = collectConsoleErrors(page);
  await resetFactors(OWNER);

  await loginWithEmailCode(page, OWNER);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });

  // Find the employee on either tab (a failed earlier run may have left them out of service).
  await page.goto("/manage/team?toon=uit-dienst");
  const leftLink = page.getByRole("link", { name: EMPLOYEE_NAME });
  if ((await leftLink.count()) > 0) {
    await leftLink.click();
    await button(page, "Terug in dienst").click();
    await expect(page.getByText(`${EMPLOYEE_NAME} is in dienst.`)).toBeVisible();
  } else {
    await page.goto("/manage/team");
    await page.getByRole("link", { name: EMPLOYEE_NAME }).click();
  }
  await expect(page).toHaveURL(/\/manage\/medewerker\/[0-9a-f-]{36}$/);
  const detailUrl = page.url();

  // 1. "Uit dienst": the first button only explains, the second one acts.
  await button(page, "Uit dienst").click();
  const confirm = page.getByRole("region", {
    name: `${EMPLOYEE_NAME} uit dienst zetten?`,
  });
  await expect(confirm).toContainText("kan niet meer inloggen");
  await expect(confirm).toContainText("Alle geregistreerde uren blijven bewaard.");
  await button(page, "Ja, zet uit dienst").click();
  await expect(page.getByText(/^Uit dienst sinds /)).toBeVisible({ timeout: 15_000 });

  await page.goto("/manage/team?toon=uit-dienst");
  await expect(page.getByRole("link", { name: EMPLOYEE_NAME })).toBeVisible();
  await page.goto("/manage/team");
  await expect(page.getByRole("link", { name: EMPLOYEE_NAME })).toHaveCount(0);

  // 2. The AVG subject export: one JSON file with every section.
  await page.goto(detailUrl);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Inzage-export (AVG)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^inzage_[0-9a-f]{8}_\d{4}-\d{2}-\d{2}\.json$/,
  );
  const document = JSON.parse(await readFile(await download.path(), "utf8")) as Record<
    string,
    unknown
  >;
  expect(Object.keys(document).sort()).toEqual([
    "audit_log",
    "clock_events",
    "correction_requests",
    "employee",
    "format",
    "generated_at",
    "invitations",
    "memberships",
    "organization",
    "pin",
    "schedules",
    "site_assignments",
  ]);
  expect(document["employee"]).toMatchObject({
    display_name: EMPLOYEE_NAME,
    active: false,
  });

  // 3. The employee can no longer get into /app.
  const refused = await employeeLogin(browser);
  await expect(refused).toHaveURL(/\/geen-toegang$/, { timeout: 15_000 });
  await expect(refused.getByRole("heading", { name: "Geen toegang" })).toBeVisible();
  await refused.goto("/app");
  await expect(refused).not.toHaveURL(/\/app$/);
  await refused.context().close();

  // 4. "Terug in dienst", and the employee gets in again.
  await page.goto(detailUrl);
  await button(page, "Terug in dienst").click();
  await expect(page.getByText(`${EMPLOYEE_NAME} is in dienst.`)).toBeVisible({
    timeout: 15_000,
  });

  const welcomed = await employeeLogin(browser);
  await expect(welcomed).toHaveURL(/\/app$/, { timeout: 15_000 });
  await welcomed.context().close();

  expect(consoleErrors).toEqual([]);
});
