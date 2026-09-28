import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Schedule journey: a manager sets today's block for an employee's weekly
 * schedule (`rpc_set_schedule`), valid from today, and the employee sees it
 * both on `/app` ("Vandaag gepland") and on `/app/uren` ("Mijn rooster").
 * Reuses the manager TOTP enrolment pattern from `manager-journey.spec.ts`,
 * with separate browser contexts per actor. Idempotent: schedule versions
 * append, so running this again just appends a newer version with the same
 * block — the assertions only care about the version in force today.
 */
const EMPLOYEE = "schedule-e2e@demo.test";
const EMPLOYEE_NAME = "Sam Testrooster";
const MANAGER = "manager-e2e@demo.test";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Today's date key (YYYY-MM-DD) in Brussels local time. */
function todayDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(
    new Date(),
  );
}

/**
 * Today's schedule day key (mon-sun). `todayDateKey()` is already a plain
 * Brussels-local calendar date, so parsing it as UTC and reading the UTC
 * weekday back out is safe (no timezone conversion left to do).
 */
function todayDayKey(): (typeof DAY_KEYS)[number] {
  return DAY_KEYS[new Date(`${todayDateKey()}T00:00:00Z`).getUTCDay()]!;
}

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function newActorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function enrolManagerTotp(page: Page): Promise<void> {
  await resetFactors(MANAGER);
  await loginWithEmailCode(page, MANAGER);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
}

test("manager sets today's schedule block, employee sees it", async ({ browser }) => {
  test.setTimeout(150_000);
  const managerPage = await newActorPage(browser);
  const managerErrors = collectConsoleErrors(managerPage);
  const day = todayDayKey();
  const today = todayDateKey();

  await enrolManagerTotp(managerPage);
  await managerPage.goto("/manage/team");
  await managerPage.getByRole("link", { name: EMPLOYEE_NAME }).click();
  await expect(managerPage).toHaveURL(/\/manage\/medewerker\/.+/);

  await managerPage.getByRole("link", { name: "Rooster aanpassen" }).click();
  await expect(managerPage).toHaveURL(/\/manage\/medewerker\/.+\/rooster$/);

  // Idempotent across runs: only add a first block if the day doesn't
  // already have one from an earlier run (a fresh version always starts
  // from the current one), then (re)set its times either way.
  const dayRow = managerPage.getByTestId(`schedule-day-${day}`);
  if ((await dayRow.locator('input[type="time"]').count()) === 0) {
    await dayRow.getByRole("button", { name: "Blok toevoegen" }).click();
  }
  await dayRow.locator(`#schedule-${day}-0-start`).fill("08:00");
  await dayRow.locator(`#schedule-${day}-0-end`).fill("16:00");

  await managerPage.getByLabel("Geldig vanaf").fill(today);
  await button(managerPage, "Rooster opslaan").click();
  await expect(managerPage.getByText("Het rooster is opgeslagen.")).toBeVisible({
    timeout: 15_000,
  });

  // The employee sees today's block on the clock screen and in "Mijn uren".
  const employeePage = await newActorPage(browser);
  const employeeErrors = collectConsoleErrors(employeePage);
  await loginWithEmailCode(employeePage, EMPLOYEE);
  await expect(employeePage).toHaveURL(/\/app$/);
  await expect(employeePage.getByText("Vandaag gepland: 08:00–16:00")).toBeVisible();

  await employeePage.goto("/app/uren");
  await expect(
    employeePage.getByRole("heading", { name: "Mijn rooster" }),
  ).toBeVisible();
  await expect(
    employeePage.getByTestId("schedule-this-week").getByText("08:00–16:00"),
  ).toBeVisible();

  expect(managerErrors).toEqual([]);
  expect(employeeErrors).toEqual([]);
});
