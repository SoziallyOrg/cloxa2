import { expect, test, type Page } from "@playwright/test";

import { collectConsoleErrors, loginWithEmailCode } from "./support";

/**
 * Employee day: clock in, break, clock out, see the shift in "Mijn uren",
 * ask for a correction and see it pending in "Vragen". Repeatable: it first
 * clocks the employee out if a previous run left them working, and withdraws
 * its own leftover requests (so the pending cap is never reached).
 */
const EMPLOYEE = "jan@demo.test";
const REASON_PREFIX = "E2E-test";
const TIME = /\d{1,2}[:.]\d{2}/;
const RANGE = /(\d{1,2}[:.]\d{2})–(\d{1,2}[:.]\d{2})/;

// After a clock action: the server round trip plus the 2.5 s confirmation.
const SETTLED = { timeout: 15_000 };

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** Brings the employee to "off", whatever state an earlier run left behind. */
async function ensureOff(page: Page): Promise<void> {
  const start = button(page, "Start werk");
  const stop = button(page, "Stop werk");
  const endBreak = button(page, "Stop pauze");
  await expect(start.or(stop).or(endBreak)).toBeVisible();
  if (await endBreak.isVisible()) {
    await endBreak.click();
    await expect(stop).toBeVisible(SETTLED);
  }
  if (await stop.isVisible()) {
    await stop.click();
    await expect(start).toBeVisible(SETTLED);
  }
}

async function withdrawLeftovers(page: Page): Promise<void> {
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

test("employee clocks a shift with a break, sees it in Mijn uren and asks for a correction", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const consoleErrors = collectConsoleErrors(page);
  const reason = `${REASON_PREFIX} ${Date.now()}`;

  await loginWithEmailCode(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/app$/);
  await withdrawLeftovers(page);

  await page.goto("/app");
  await ensureOff(page);
  await expect(page.getByText("Niet aan het werk", { exact: true })).toBeVisible();

  // Clock in: the confirmation, then the working state from the server.
  await button(page, "Start werk").click();
  await expect(page.getByRole("status")).toContainText("Gestart om", SETTLED);
  await expect(page.getByText("Aan het werk", { exact: true })).toBeVisible(SETTLED);
  const since = page.getByText(/^Gestart om \d{1,2}[:.]\d{2} · geen pauze$/);
  await expect(since).toBeVisible(SETTLED);
  const startedAt = TIME.exec(await since.innerText())![0];

  await button(page, "Pauze").click();
  await expect(page.getByText("Met pauze", { exact: true })).toBeVisible(SETTLED);
  await expect(page.getByText(/ · pauze sinds \d{1,2}[:.]\d{2}$/)).toBeVisible();
  await button(page, "Stop pauze").click();
  await expect(button(page, "Stop werk")).toBeVisible(SETTLED);
  await button(page, "Stop werk").click();
  await expect(button(page, "Start werk")).toBeVisible(SETTLED);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  // Mijn uren: newest first, with a week total; the newest shift is the one
  // just made, closed, and starts when the clock said it did.
  await page.getByRole("link", { name: "Uren", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/uren$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mijn uren");
  await expect(page.getByText("Deze week gewerkt", { exact: true })).toBeVisible();
  await expect(page.getByText("indicatief", { exact: true })).toBeVisible();
  const newest = page.getByRole("main").getByRole("listitem").first();
  const range = RANGE.exec(await newest.innerText());
  expect(range?.[1]).toBe(startedAt);

  // The day's detail opens in a sheet, with "Klopt er iets niet?".
  await newest.getByRole("button").click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText(range![0]);

  // Correction, in three steps: the clock-out "does not belong here".
  await detail.getByRole("link", { name: "Klopt er iets niet?" }).click();
  await expect(page).toHaveURL(/\/app\/vragen\/nieuw\?datum=\d{4}-\d{2}-\d{2}&dienst=/);
  await expect(page.getByText("Stap 1 van 3")).toBeVisible();
  await button(page, "Deze registratie hoort er niet bij").click();
  await button(page, "Volgende").click();

  await expect(page.getByText("Stap 2 van 3")).toBeVisible();
  // Started from the shift: its day is chosen and only its four events show.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Welke registratie?",
  );
  const targets = page.getByRole("main").getByRole("list").getByRole("button");
  await expect(targets).toHaveCount(4);
  await button(page, `Gestopt met werken om ${range![2]}`).click();
  await button(page, "Volgende").click();

  await expect(page.getByText("Stap 3 van 3")).toBeVisible();
  await page.getByLabel(/^Reden/).fill(reason);
  await expect(page.getByText(`Reden: ${reason}`)).toBeVisible();
  await button(page, "Versturen").click();
  await expect(page.getByRole("status")).toHaveText("Je melding is verstuurd.");

  // Vragen: the request is pending; withdrawing it keeps the next run clean.
  await page.getByRole("link", { name: "Vragen", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/vragen$/);
  const request = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: reason });
  await expect(request).toContainText("In behandeling");
  await request.getByRole("button", { name: "Intrekken" }).click();
  await expect(request).toContainText("Ingetrokken");

  expect(consoleErrors).toEqual([]);
});
