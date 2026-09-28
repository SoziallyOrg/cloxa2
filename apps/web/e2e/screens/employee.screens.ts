import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { clearMailbox, latestCode } from "../support";

/**
 * Design-review screenshots of the login and the employee app (`pnpm screens`),
 * at phone and desktop size, light and dark. Not a test of behaviour: the
 * e2e specs do that. Uses the dedicated `screens-e2e@demo.test` account,
 * which `dev:seed` gives a few weeks of made-up history. Leaves the account
 * working, so the next run shows a running timer.
 */
const EMPLOYEE = "screens-e2e@demo.test";
const OUT = resolve(process.cwd(), "output/screens");
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const SCHEMES = ["light", "dark"] as const;
const SETTLED = { timeout: 20_000 };

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/**
 * Every viewport × colour scheme. The viewport grows to the page height
 * instead of a `fullPage` shot, which would leave the fixed tab bar halfway
 * down a long page. Open sheets are shot at the plain viewport size.
 */
async function capture(page: Page, name: string, whole = true): Promise<void> {
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    for (const colorScheme of SCHEMES) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (whole) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ ...size, height: Math.max(size.height, height) });
      }
      await page.screenshot({
        path: `${OUT}/${name}-${viewport}-${colorScheme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize(VIEWPORTS.phone);
}

/** Closes an open sheet, and drops the focus ring it hands back. */
async function closeSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** The 2-second confirmation, frozen long enough to photograph it. */
async function captureConfirmation(page: Page, action: string, text: string) {
  await button(page, action).click();
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible(SETTLED);
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 50);
  await capture(page, "klok-bevestiging");
  await page.clock.resume();
  await waitForConfirmationGone(page);
}

async function waitForConfirmationGone(page: Page): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: / om \d/ })).toHaveCount(
    0,
    SETTLED,
  );
}

async function press(page: Page, action: string): Promise<void> {
  await button(page, action).click();
  await expect(page.getByRole("status").filter({ hasText: / om \d/ })).toBeVisible(
    SETTLED,
  );
  await waitForConfirmationGone(page);
}

test("employee screens", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.clock.install();
  await page.setViewportSize(VIEWPORTS.phone);

  // Login and the code step.
  await clearMailbox(page.request, EMPLOYEE);
  await page.goto("/login");
  await capture(page, "login");
  await page.getByLabel("Je e-mailadres").fill(EMPLOYEE);
  await button(page, "Stuur mij een code").click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await capture(page, "login-code");
  await page
    .getByLabel("Code uit de e-mail")
    .fill(await latestCode(page.request, EMPLOYEE));
  await button(page, "Inloggen").click();
  await expect(page).toHaveURL(/\/app$/, SETTLED);

  // Klok: working, on break, off and the confirmation, whatever the start state.
  await expect(
    button(page, "Start werk")
      .or(button(page, "Stop werk"))
      .or(button(page, "Stop pauze")),
  ).toBeVisible();
  if (await button(page, "Stop pauze").isVisible()) await press(page, "Stop pauze");
  if (await button(page, "Start werk").isVisible()) {
    await capture(page, "klok-uit");
    await captureConfirmation(page, "Start werk", "Gestart om");
    await expect(button(page, "Stop werk")).toBeVisible(SETTLED);
    await capture(page, "klok-werk");
    await press(page, "Pauze");
    await capture(page, "klok-pauze");
    await press(page, "Stop pauze");
  } else {
    await capture(page, "klok-werk");
    await press(page, "Pauze");
    await capture(page, "klok-pauze");
    await press(page, "Stop pauze");
    await press(page, "Stop werk");
    await capture(page, "klok-uit");
    await captureConfirmation(page, "Start werk", "Gestart om");
  }

  // The account sheet, opened from the name.
  await button(page, "Sanne P.").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "account", false);
  await closeSheet(page);

  // Offline: the banner.
  await context.setOffline(true);
  await expect(page.getByText(/^Geen internet\./)).toBeVisible(SETTLED);
  await capture(page, "offline");
  await context.setOffline(false);
  await expect(page.getByText(/^Geen internet\./)).toHaveCount(0, SETTLED);

  // Uren, and one day's detail.
  await page.goto("/app/uren");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mijn uren");
  await capture(page, "uren");
  await page.getByRole("main").getByRole("listitem").nth(2).getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "uren-dag", false);
  await closeSheet(page);

  // Vragen and each wizard step (never sent).
  await page.goto("/app/vragen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vragen");
  await capture(page, "vragen");
  await page.getByRole("link", { name: "Nieuwe vraag" }).click();
  await expect(page.getByText("Stap 1 van 3")).toBeVisible();
  await button(page, "Een tijd klopt niet").click();
  await capture(page, "vraag-stap-1");
  await button(page, "Volgende").click();
  await expect(page.getByText("Stap 2 van 3")).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("listitem")
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("Tijdstip").fill("08:00");
  await capture(page, "vraag-stap-2");
  await button(page, "Volgende").click();
  await expect(page.getByText("Stap 3 van 3")).toBeVisible();
  await page.getByLabel(/^Reden/).fill("Ik ben om 08:00 begonnen.");
  await capture(page, "vraag-stap-3");

  // Instellingen and the kiosk PIN.
  await page.goto("/app/instellingen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instellingen");
  await capture(page, "instellingen");
  await page.getByRole("link", { name: /Kiosk-pincode/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kiosk-pincode");
  await capture(page, "instellingen-pincode");
});
