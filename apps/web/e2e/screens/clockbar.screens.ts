import { execSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { button, capture, enrol, SETTLED, VIEWPORTS } from "./helpers";

/**
 * The clock bar in `/manage` (`pnpm screens`): a manager who also clocks.
 * `screens-klokbalk@demo.test` is a manager of "Bakkerij Zon (fictief)" with
 * an employee record of her own (see dev-seed). She clocks in on Klok, then
 * the bar shows on Vandaag: working, on pause, and the Stop werk question.
 * The test clocks out again at the end, so the bakery's "today" stays as seeded.
 */
const MANAGER = "screens-klokbalk@demo.test";

const bar = (page: Page) => page.getByRole("region", { name: "Jouw klok" });
const visibleBar = (page: Page) => bar(page).filter({ visible: true });

test("a manager who also clocks: the clock bar on Vandaag", async ({ page }) => {
  test.setTimeout(300_000);
  // Local-only (the seed refuses anything but loopback): creates the account.
  execSync("pnpm --filter @cloxa/web dev:seed", { stdio: "inherit" });
  await page.setViewportSize(VIEWPORTS.desktop);
  await enrol(page, MANAGER, false);

  // Clock in on Klok (the bar stays away from there). Left open by an earlier
  // failed run: just carry on from that state.
  await page.goto("/app");
  const start = button(page, "Start werk");
  if (await start.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await start.click();
    await expect(page.getByRole("status").filter({ hasText: /Gestart om/ })).toBeHidden(
      SETTLED,
    );
  }
  const resume = button(page, "Verder werken");
  if (await resume.isVisible().catch(() => false)) await resume.click();

  await page.goto("/manage");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vandaag", SETTLED);
  await expect(visibleBar(page)).toContainText("Jij werkt", SETTLED);
  await capture(page, "beheer-klokbalk-werkt");

  // On pause: the bar turns amber.
  await visibleBar(page).getByRole("button", { name: "Pauze", exact: true }).click();
  await expect(visibleBar(page)).toContainText("Je bent op pauze", SETTLED);
  await capture(page, "beheer-klokbalk-pauze");

  // Stop werk asks once.
  await visibleBar(page).getByRole("button", { name: "Stop werk" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await capture(page, "beheer-klokbalk-stop", false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Tidy up: back to work, then stop for real.
  await visibleBar(page).getByRole("button", { name: "Verder werken" }).click();
  await expect(visibleBar(page)).toContainText("Jij werkt", SETTLED);
  await visibleBar(page).getByRole("button", { name: "Stop werk" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ja, stop werk" })
    .click();
  await expect(bar(page)).toHaveCount(0, SETTLED);
});
