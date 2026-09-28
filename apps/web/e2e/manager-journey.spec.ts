import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Manager journey: an employee requests a correction, the manager approves
 * it in Aanvragen and sees the "aangepast" shift on the employee's detail
 * page, then invites and revokes a new team member. Reuses the manager
 * login + TOTP enrolment from `manager.spec.ts`'s pattern. Idempotent: it
 * withdraws its own leftover requests first and always revokes the
 * invitation it creates.
 */
// Els is used only by this spec, so other specs can't leave events that collide with
// the "forgot to clock in" correction below (clock events are append-only).
const EMPLOYEE = "els@demo.test";
const EMPLOYEE_NAME = "Els Maes";
const MANAGER = "manager-e2e@demo.test";
const REASON_PREFIX = "E2E-manager-test";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** Brings the employee to "off", whatever state an earlier run left behind. */
async function ensureOff(page: Page): Promise<void> {
  const start = button(page, "Start werk");
  const stop = button(page, "Stop werk");
  const endBreak = button(page, "Pauze stoppen");
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
 * The "missed clock-in" must land after the employee's latest event (clock
 * events are append-only, so earlier runs' events stay). The form works in
 * whole minutes, so wait for the next minute boundary and propose that
 * minute: strictly after any event from before the wait, and never in the
 * future.
 */
async function nextMinuteInBrussels(page: Page): Promise<string> {
  const msToBoundary = 60_000 - (Date.now() % 60_000) + 1_000;
  await page.waitForTimeout(msToBoundary);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/** Each actor gets its own browser context, like two separate phones. */
async function newActorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function withdrawEmployeeLeftovers(page: Page): Promise<void> {
  await page.goto("/app/vragen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vragen");
  const leftovers = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: REASON_PREFIX })
    .filter({ has: button(page, "Intrekken") });
  for (let count = await leftovers.count(); count > 0; count -= 1) {
    await leftovers.first().getByRole("button", { name: "Intrekken" }).click();
    await expect(leftovers).toHaveCount(count - 1);
  }
}

async function enrolManagerTotp(page: Page): Promise<void> {
  await resetFactors(MANAGER);
  await loginWithEmailCode(page, MANAGER);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await page.getByRole("button", { name: "Start met instellen" }).click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
}

test("manager approves a correction and invites a new team member", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newActorPage(browser);
  const consoleErrors = collectConsoleErrors(page);
  const reason = `${REASON_PREFIX} ${Date.now()}`;

  // 1. The employee requests a missed clock-in via the UI.
  await loginWithEmailCode(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/app$/);
  await ensureOff(page);
  await withdrawEmployeeLeftovers(page);
  const missedClockIn = await nextMinuteInBrussels(page);

  await page.goto("/app/vragen/nieuw");
  await expect(page.getByText("Stap 1 van 3")).toBeVisible();
  await button(page, "Ik vergat in te klokken").click();
  await button(page, "Volgende").click();

  await expect(page.getByText("Stap 2 van 3")).toBeVisible();
  await page.getByLabel("Wat gebeurde er?").selectOption("clock_in");
  await page.getByLabel("Tijdstip").fill(missedClockIn);
  await button(page, "Volgende").click();

  await expect(page.getByText("Stap 3 van 3")).toBeVisible();
  await page.getByLabel(/^Reden/).fill(reason);
  await button(page, "Versturen").click();
  // The correction write (append-only, hash-chained audit row) can take a
  // few seconds against the local Supabase stack.
  await expect(page.getByRole("status")).toHaveText("Je melding is verstuurd.", {
    timeout: 15_000,
  });

  // 2. The manager works in a separate browser context (their own device).
  const employeePage = page;
  const managerPage = await newActorPage(browser);
  const managerErrors = collectConsoleErrors(managerPage);
  await enrolManagerTotp(managerPage);
  await managerPage.goto("/manage/vragen");
  await expect(managerPage.getByRole("heading", { level: 1 })).toHaveText("Aanvragen");

  const request = managerPage.getByRole("listitem").filter({ hasText: reason });
  await expect(request).toBeVisible();
  await expect(request).toContainText(EMPLOYEE_NAME);
  await expect(request).toContainText("Na"); // "voor -> na" diff is shown.

  await request.getByRole("button", { name: "Goedkeuren" }).click();
  await expect(managerPage).toHaveURL(/\/manage\/vragen$/);
  await expect(
    managerPage.getByRole("listitem").filter({ hasText: reason }),
  ).toHaveCount(0);

  // 3. The employee's detail page shows the resulting "aangepast" shift.
  await managerPage.goto("/manage/team");
  await managerPage.getByRole("link", { name: EMPLOYEE_NAME }).click();
  await expect(managerPage).toHaveURL(/\/manage\/medewerker\/.+/);
  await expect(managerPage.getByText("aangepast").first()).toBeVisible();

  // 4. Invite a new employee, see them as "uitgenodigd", then revoke it.
  const newEmail = `e2e-invite-${Date.now()}@demo.test`;
  await managerPage.goto("/manage/team");
  await managerPage.getByLabel("Naam").fill("E2E Nieuwe Collega");
  await managerPage.getByLabel("E-mailadres").fill(newEmail);
  const [siteCheckbox] = await managerPage.getByRole("checkbox").all();
  await siteCheckbox!.check();
  await button(managerPage, "Uitnodiging versturen").click();
  await expect(managerPage.getByText("De uitnodiging is verstuurd.")).toBeVisible({
    timeout: 15_000,
  });

  const invitationRow = managerPage.getByRole("listitem").filter({ hasText: newEmail });
  await expect(invitationRow).toBeVisible();
  await invitationRow.getByRole("button", { name: "Intrekken" }).click();
  await expect(
    managerPage.getByRole("listitem").filter({ hasText: newEmail }),
  ).toHaveCount(0);

  // 5. The approved "add" correction appends only a clock_in, leaving an
  // open shift. The employee clocks out on their own device, so the next
  // run starts from "off" too (ensureOff also covers a crashed run).
  await employeePage.goto("/app");
  await ensureOff(employeePage);

  expect(consoleErrors).toEqual([]);
  expect(managerErrors).toEqual([]);
});
