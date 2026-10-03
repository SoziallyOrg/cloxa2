import { expect, test, type Page } from "@playwright/test";

import { loginWithEmailCode } from "./support";

/**
 * Offline clocking (ADR 006): a clock-in without a connection is kept on the
 * device, synced once back online, and shows as "offline" in Mijn uren.
 * Repeatable: it first clocks the dedicated employee out if a previous run
 * left them working, and clocks out again at the end.
 */
const EMPLOYEE = "offline-e2e@demo.test";

// A sync or a clock action: the server round trip plus the 2.5 s confirmation.
const SETTLED = { timeout: 20_000 };

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function ensureOff(page: Page): Promise<void> {
  const start = button(page, "Start werk");
  const stop = button(page, "Stop werk");
  const endBreak = button(page, "Verder werken");
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

test("a clock-in made offline is kept, synced when back online and marked offline", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  await loginWithEmailCode(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/app$/);
  await ensureOff(page);
  await expect(button(page, "Start werk")).toBeVisible();

  // Offline: the button still works and the action waits on the device.
  await context.setOffline(true);
  await expect(page.getByText(/^Geen internet\. Je kan gewoon klokken/)).toBeVisible();
  await button(page, "Start werk").click();
  await expect(
    page.getByRole("status").filter({ hasText: "Gestart om" }),
  ).toContainText("Bewaard op je toestel, wordt verstuurd zodra je verbinding hebt.");
  await expect(page.getByText("Nog niet verstuurd")).toBeVisible();
  await expect(page.getByText("Je werkt", { exact: true })).toBeVisible(SETTLED);
  await expect(page.getByText(/^sinds \d{1,2}[:.]\d{2}$/)).toBeVisible();

  // Back online: the queue syncs by itself and the badge goes away.
  await context.setOffline(false);
  await expect(page.getByText("Nog niet verstuurd")).toHaveCount(0, SETTLED);
  await page.reload();
  await expect(page.getByText("Je werkt", { exact: true })).toBeVisible();
  await expect(button(page, "Stop werk")).toBeVisible();

  // Mijn uren: the open shift carries the offline badge.
  await page.getByRole("link", { name: "Uren", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/uren$/);
  const newest = page
    .getByRole("main")
    .getByRole("list", { name: "Je uren per dag" })
    .getByRole("listitem")
    .first();
  await expect(newest).toContainText("nog bezig");
  await expect(newest.getByText("offline", { exact: true })).toBeVisible();

  // Clean up: clock out again, online.
  await page.getByRole("link", { name: "Klok" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await ensureOff(page);
  await expect(button(page, "Start werk")).toBeVisible();
});
