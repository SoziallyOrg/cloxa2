import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Kiosk journey (ADR 005): an admin sets a kiosk PIN for an employee without
 * using the employee's own login, creates a kiosk for site 1 and reads the
 * pairing code. A separate browser context (the tablet, no session) pairs,
 * taps the employee, enters the PIN, starts work, sees the confirmation and
 * returns to the name tiles on its own. A wrong PIN shows an error.
 *
 * Idempotent: setting the PIN lifts any lockout from earlier runs, and the
 * tablet first brings the employee back to "off" through the kiosk itself.
 * Every run creates (and at the end revokes) its own kiosk.
 */
const ADMIN = "kiosk-admin@demo.test";
const EMPLOYEE_NAME = "Karel Kiosktest";
const FIRST_NAME = "Karel";
const SITE_NAME = "Bakkerij Demo (fictief)";
const PIN = "2580";
const WRONG_PIN = "1397";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function newActorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function enrolAdminTotp(page: Page): Promise<void> {
  await resetFactors(ADMIN);
  await loginWithEmailCode(page, ADMIN);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
}

/** Taps the employee's tile and types a PIN on the pad. */
async function enterPin(tablet: Page, pin: string): Promise<void> {
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible();
  await button(tablet, EMPLOYEE_NAME).click();
  await expect(
    tablet.getByRole("heading", { name: "Voer je pincode in" }),
  ).toBeVisible();
  for (const digit of pin) await button(tablet, digit).click();
  await button(tablet, "OK").click();
}

/** Stops a break and/or work left open by an earlier run, via the kiosk. */
async function ensureOff(tablet: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enterPin(tablet, PIN);
    await expect(
      tablet.getByRole("heading", { name: `Hallo ${FIRST_NAME}` }),
    ).toBeVisible();
    const next = ["Verder werken", "Stop werk"];
    const open: string[] = [];
    for (const name of next) {
      if (await button(tablet, name).isVisible()) open.push(name);
    }
    if (open.length === 0) {
      await expect(button(tablet, "Start werk")).toBeVisible();
      await button(tablet, "Terug").click();
      return;
    }
    await button(tablet, open[0]!).click();
    await button(tablet, "Klaar").click();
  }
  throw new Error("could not bring the kiosk employee back to off");
}

test("admin pairs a kiosk; an employee without login clocks in with a PIN", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await newActorPage(browser);
  const adminErrors = collectConsoleErrors(admin);
  const kioskName = `E2E tablet ${Date.now()}`;

  await enrolAdminTotp(admin);

  // The PIN, set by the admin: the way for staff without a login.
  await admin.goto("/manage/team");
  await admin.getByRole("link", { name: EMPLOYEE_NAME }).click();
  await expect(admin).toHaveURL(/\/manage\/medewerker\/.+/);
  await admin.getByRole("button", { name: /^Kiosk-pincode/ }).click();
  await admin.getByLabel("Nieuwe pincode").fill(PIN);
  await admin.getByLabel("Herhaal de pincode").fill(PIN);
  await button(admin, "Kiosk-pincode instellen").click();
  await expect(admin.getByText("De pincode is ingesteld.")).toBeVisible({
    timeout: 15_000,
  });

  // A new kiosk for site 1, reached from Meer.
  await admin.goto("/manage/meer");
  // The desktop sidebar has a Kiosks item too: take the one in the page.
  await admin
    .getByRole("main")
    .getByRole("link", { name: "Kiosks", exact: true })
    .click();
  await expect(admin).toHaveURL(/\/manage\/meer\/kiosks$/);
  await button(admin, "Nieuwe kiosk").click();
  await admin.getByLabel("Locatie").selectOption({ label: SITE_NAME });
  await admin.getByLabel("Naam van de tablet").fill(kioskName);
  await button(admin, "Kiosk aanmaken").click();
  const codeText = admin.getByTestId("pairing-code");
  await expect(codeText).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, {
    timeout: 15_000,
  });
  await expect(admin.getByText(/Open op de tablet: .*\/kiosk\/koppelen/)).toBeVisible();
  const code = await codeText.innerText();

  // The tablet: its own context, never signed in.
  const tablet = await newActorPage(browser);
  const tabletErrors = collectConsoleErrors(tablet);
  await tablet.goto("/kiosk");
  await expect(
    tablet.getByRole("heading", { name: "Deze tablet is nog niet gekoppeld" }),
  ).toBeVisible();
  await tablet.getByRole("link", { name: "Tablet koppelen" }).click();
  await expect(tablet).toHaveURL(/\/kiosk\/koppelen$/);
  await tablet.getByLabel("Koppelcode").fill(code.toLowerCase());
  await button(tablet, "Koppelen").click();
  await expect(tablet).toHaveURL(/\/kiosk$/, { timeout: 15_000 });

  await ensureOff(tablet);

  // A wrong PIN is refused with a friendly message.
  await enterPin(tablet, WRONG_PIN);
  await expect(tablet.getByText("Deze pincode klopt niet.")).toBeVisible();
  await button(tablet, "Terug").click();

  // Start work: the confirmation names the time and the first name, never hours.
  await enterPin(tablet, PIN);
  await button(tablet, "Start werk").click();
  await expect(
    tablet.getByText(new RegExp(`^Gestart om \\d{2}:\\d{2}, ${FIRST_NAME}$`)),
  ).toBeVisible({ timeout: 15_000 });

  // Back to the name tiles on its own after 5 seconds.
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible({
    timeout: 10_000,
  });

  // Tidy up: revoke this run's kiosk; the tablet then says so.
  await admin.reload();
  const item = admin.getByRole("row").filter({ hasText: kioskName });
  // The row offers the choices ("Beheren"); revoking asks once more in an alert.
  await item.getByRole("button", { name: "Beheren" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Intrekken" }).click();
  await admin
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ja, trek in" })
    .click();
  await expect(item.getByText("Ingetrokken")).toBeVisible({ timeout: 15_000 });
  await tablet.reload();
  await expect(
    tablet.getByRole("heading", { name: "Deze tablet is niet meer gekoppeld" }),
  ).toBeVisible();

  expect(adminErrors).toEqual([]);
  expect(tabletErrors).toEqual([]);
});
