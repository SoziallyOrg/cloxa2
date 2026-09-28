import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { clearMailbox, latestCode, loginWithEmailCode } from "../support";

/**
 * Design-review screenshots of the login and the employee app (`pnpm screens`),
 * at phone and desktop size, light and dark. Not a test of behaviour: the
 * e2e specs do that.
 *
 * Each Klok state has its own account, which `dev:seed` (run first) brings to
 * a realistic "today" on every run: working since about 3.5 hours, on a short
 * break, or not started. Those accounts are never clocked with here; the one
 * live action (the confirmation) uses `screens-actie@demo.test`.
 */
const WORKING = "screens-e2e@demo.test";
const ON_BREAK = "screens-pauze@demo.test";
const OFF = "screens-uit@demo.test";
const ACTION = "screens-actie@demo.test";

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
  // No hover state left from the last click.
  await page.mouse.move(0, 0);
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

const confirmation = (page: Page) =>
  page.getByRole("status").filter({ hasText: / om \d/ });

async function press(page: Page, action: string): Promise<void> {
  await button(page, action).click();
  await expect(confirmation(page)).toBeVisible(SETTLED);
  await expect(confirmation(page)).toHaveCount(0, SETTLED);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(180_000);
  // Local-only (the seed refuses anything but loopback): resets "today".
  execSync("pnpm --filter @cloxa/web dev:seed", { stdio: "inherit" });
});

test("login, and the employee app while working", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORTS.phone);

  await clearMailbox(page.request, WORKING);
  await page.goto("/login");
  await capture(page, "login");
  await page.getByLabel("Je e-mailadres").fill(WORKING);
  await button(page, "Stuur mij een code").click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await capture(page, "login-code");
  await page
    .getByLabel("Code uit de e-mail")
    .fill(await latestCode(page.request, WORKING));
  await button(page, "Inloggen").click();
  await expect(page).toHaveURL(/\/app$/, SETTLED);

  await expect(button(page, "Stop werk")).toBeVisible();
  await capture(page, "klok-werk");

  await button(page, "Sanne P.").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "account", false);
  await closeSheet(page);

  await context.setOffline(true);
  await expect(page.getByText(/^Geen internet\./)).toBeVisible(SETTLED);
  await capture(page, "offline");
  await context.setOffline(false);
  await expect(page.getByText(/^Geen internet\./)).toHaveCount(0, SETTLED);

  // Uren, one day's detail, and "Klopt er iets niet?" from there.
  await page.goto("/app/uren");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mijn uren");
  await capture(page, "uren");
  await page.getByRole("main").getByRole("listitem").nth(1).getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "uren-dag", false);
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Klopt er iets niet?" })
    .click();
  await button(page, "Een tijd klopt niet").click();
  await button(page, "Volgende").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welk moment?");
  await capture(page, "vraag-vanuit-uren");

  // Vragen, and the wizard from "Nieuwe vraag" (never sent).
  await page.goto("/app/vragen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vragen");
  await capture(page, "vragen");
  await page.getByRole("link", { name: "Nieuwe vraag" }).click();
  await expect(page.getByText("Stap 1 van 3")).toBeVisible();
  await button(page, "Een tijd klopt niet").click();
  await capture(page, "vraag-stap-1");
  await button(page, "Volgende").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welke dag?");
  await capture(page, "vraag-stap-2-dag");
  // The most recent finished day.
  await page
    .getByRole("button", { name: /, \d{2}:\d{2}–\d{2}:\d{2}/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Gestopt met werken om / }).click();
  await page.getByLabel("Juiste tijd").fill("17:05");
  await capture(page, "vraag-stap-2-moment");
  await button(page, "Volgende").click();
  await expect(page.getByText("Stap 3 van 3")).toBeVisible();
  await page.getByLabel(/^Reden/).fill("Ik ben later gestopt: de levering kwam laat.");
  await capture(page, "vraag-stap-3");

  // "Ik vergat in te klokken": the day, then the time.
  await page.goto("/app/vragen/nieuw");
  await button(page, "Ik vergat in te klokken").click();
  await button(page, "Volgende").click();
  await page.getByRole("button", { name: /^Gisteren, / }).click();
  await button(page, "Begonnen met werken").click();
  await page.getByLabel("Tijdstip").fill("08:00");
  await capture(page, "vraag-vergeten");

  await page.goto("/app/instellingen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instellingen");
  await capture(page, "instellingen");
  await page.getByRole("link", { name: /Kiosk-pincode/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kiosk-pincode");
  await capture(page, "instellingen-pincode");
});

test("the clock on a break", async ({ page }) => {
  test.setTimeout(120_000);
  await loginWithEmailCode(page, ON_BREAK);
  await expect(button(page, "Stop pauze")).toBeVisible(SETTLED);
  await capture(page, "klok-pauze");
});

test("the clock before work", async ({ page }) => {
  test.setTimeout(120_000);
  await loginWithEmailCode(page, OFF);
  await expect(button(page, "Start werk")).toBeVisible(SETTLED);
  await capture(page, "klok-uit");
});

test("the confirmation after clocking", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await loginWithEmailCode(page, ACTION);
  await expect(
    button(page, "Start werk")
      .or(button(page, "Stop werk"))
      .or(button(page, "Stop pauze")),
  ).toBeVisible(SETTLED);
  if (await button(page, "Stop pauze").isVisible()) await press(page, "Stop pauze");
  if (await button(page, "Stop werk").isVisible()) await press(page, "Stop werk");

  // Frozen for the photo: it normally goes after 2 seconds.
  await button(page, "Start werk").click();
  await expect(confirmation(page)).toContainText("Gestart om", SETTLED);
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 50);
  await capture(page, "klok-bevestiging");
  await page.clock.resume();
  await expect(confirmation(page)).toHaveCount(0, SETTLED);
  await press(page, "Stop werk");
});
