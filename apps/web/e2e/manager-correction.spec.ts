import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * A manager fixes an employee's forgotten clock-out from Vandaag (ADR 010):
 * the correction is saved at once, shows as "aangepast" on the employee's
 * page, and the employee sees "Aangepast door je leidinggevende" in Vragen.
 * Both accounts are reserved for this spec (see dev-seed.ts), so the manager's
 * TOTP factors can be reset and the employee's history is only written here.
 */
const MANAGER = "correctie-manager-e2e@demo.test";
const EMPLOYEE = "correctie-e2e@demo.test";
const EMPLOYEE_NAME = "Cor Correctietest";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** Each actor gets its own browser context, like two separate devices. */
async function newActorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** Brings the employee to "off", whatever state an earlier run left behind. */
async function ensureOff(page: Page): Promise<void> {
  const start = button(page, "Start werk");
  const stop = button(page, "Stop werk");
  const endBreak = button(page, "Verder werken");
  await expect(start.or(stop).or(endBreak)).toBeVisible();
  if (await endBreak.isVisible()) {
    await endBreak.click();
    await expect(stop).toBeVisible({ timeout: 15_000 });
  }
  if (await stop.isVisible()) {
    await stop.click();
    await expect(start).toBeVisible({ timeout: 15_000 });
  }
}

/**
 * The form works in whole minutes: wait for the next minute boundary and use
 * that minute, so it lies after the clock-in and never in the future.
 */
async function nextMinuteInBrussels(page: Page): Promise<string> {
  await page.waitForTimeout(60_000 - (Date.now() % 60_000) + 1_000);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
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

test("manager fixes a forgotten clock-out and the employee sees it", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const reason = `E2E-correctie ${Date.now()}`;

  // 1. The employee clocks in and never clocks out.
  const forgetful = await newActorPage(browser);
  await loginWithEmailCode(forgetful, EMPLOYEE);
  await expect(forgetful).toHaveURL(/\/app$/);
  await ensureOff(forgetful);
  await button(forgetful, "Start werk").click();
  await expect(button(forgetful, "Stop werk")).toBeVisible({ timeout: 15_000 });
  const clockOutAt = await nextMinuteInBrussels(forgetful);
  await forgetful.context().close();

  // 2. The manager opens the person on Vandaag and starts a correction.
  const manager = await newActorPage(browser);
  const managerErrors = collectConsoleErrors(manager);
  await enrolManagerTotp(manager);
  await manager
    .getByRole("button", { name: EMPLOYEE_NAME })
    .filter({ visible: true })
    .first()
    .click();
  await manager
    .getByRole("complementary", { name: "Details" })
    .getByRole("link", { name: "Correctie toevoegen" })
    .click();
  await expect(manager).toHaveURL(/\/correctie\?terug=vandaag$/);
  await expect(manager.getByRole("heading", { level: 1 })).toHaveText(
    `Correctie voor ${EMPLOYEE_NAME}`,
  );

  // Step 1 and 2: what is missing, on which day and at what time.
  await button(manager, "Een registratie ontbreekt").click();
  await button(manager, "Volgende").click();
  await manager.getByRole("button", { name: /^Vandaag, / }).click();
  await button(manager, "Gestopt met werken").click();
  await manager.getByLabel("Tijdstip").fill(clockOutAt);
  await button(manager, "Volgende").click();

  // Step 3: the reason is required and the employee reads it.
  await expect(manager.getByText("Stap 3 van 3")).toBeVisible();
  await expect(
    manager.getByText("Je medewerker ziet deze uitleg.", { exact: false }),
  ).toBeVisible();
  await expect(manager.getByText("Wordt", { exact: true })).toBeVisible();
  await expect(button(manager, "Correctie opslaan")).toBeDisabled();
  await manager.getByLabel(/^Reden/).fill(reason);
  await button(manager, "Correctie opslaan").click();

  // Saved at once, back on Vandaag with a notice.
  await expect(manager).toHaveURL(/\/manage\?gecorrigeerd=/, { timeout: 20_000 });
  await expect(
    manager.getByRole("status").filter({ hasText: "Correctie opgeslagen voor" }),
  ).toContainText(EMPLOYEE_NAME);

  // 3. The employee's page shows the corrected shift, with an "Aanpassen" link.
  await manager.goto("/manage/team");
  await manager.getByRole("link", { name: EMPLOYEE_NAME }).click();
  await expect(manager).toHaveURL(/\/manage\/medewerker\/[0-9a-f-]{36}$/);
  await expect(manager.getByText("aangepast").first()).toBeVisible();
  await expect(
    manager.getByRole("link", { name: "Correctie toevoegen" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("link", { name: /^Uren van .* aanpassen$/ }).first(),
  ).toBeVisible();

  // 4. The employee, on their own device, sees who changed their hours and why.
  const employee = await newActorPage(browser);
  const employeeErrors = collectConsoleErrors(employee);
  await loginWithEmailCode(employee, EMPLOYEE);
  await expect(employee).toHaveURL(/\/app$/);
  await employee.goto("/app/vragen");
  const card = employee
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: "Aangepast door je leidinggevende" })
    .filter({ hasText: reason });
  await expect(card).toBeVisible();
  await card.getByRole("button").click();
  const detail = employee.getByRole("dialog");
  await expect(detail).toContainText(reason);
  // Information, not a pending question: nothing to withdraw.
  await expect(detail.getByRole("button", { name: "Intrekken" })).toHaveCount(0);

  expect(managerErrors).toEqual([]);
  expect(employeeErrors).toEqual([]);
});
