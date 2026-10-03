import { expect, type Browser, type Page } from "@playwright/test";

import { loginWithEmailCode, resetFactors, totp } from "./support";

/**
 * The kiosk pairing flow, shared by kiosk.spec.ts and screens/kiosk.screens.ts.
 * Only the dedicated kiosk accounts are used: `kiosk-admin@` (admin) and
 * `kiosk-e2e@` ("Karel Kiosktest", site 1), both reserved for this flow.
 */
export const KIOSK_ADMIN = "kiosk-admin@demo.test";
export const KIOSK_EMPLOYEE_NAME = "Karel Kiosktest";
export const KIOSK_FIRST_NAME = "Karel";
export const KIOSK_SITE_NAME = "Bakkerij Demo (fictief)";
export const KIOSK_PIN = "2580";
export const KIOSK_WRONG_PIN = "1397";

export const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

export async function newActorPage(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<Page> {
  const context = await browser.newContext(options);
  return context.newPage();
}

export async function enrolAdminTotp(page: Page): Promise<void> {
  await resetFactors(KIOSK_ADMIN);
  await loginWithEmailCode(page, KIOSK_ADMIN);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
}

/** Sets the employee's kiosk PIN from the admin side; this also lifts a lockout. */
export async function setKioskPin(admin: Page): Promise<void> {
  await admin.goto("/manage/team");
  await admin.getByRole("link", { name: KIOSK_EMPLOYEE_NAME }).click();
  await expect(admin).toHaveURL(/\/manage\/medewerker\/.+/);
  await admin.getByRole("button", { name: /^Kiosk-pincode/ }).click();
  await admin.getByLabel("Nieuwe pincode").fill(KIOSK_PIN);
  await admin.getByLabel("Herhaal de pincode").fill(KIOSK_PIN);
  await button(admin, "Kiosk-pincode instellen").click();
  await expect(admin.getByText("De pincode is ingesteld.")).toBeVisible({
    timeout: 15_000,
  });
}

/** Creates a kiosk for site 1 (from Meer) and returns its pairing code. */
export async function createKiosk(admin: Page, kioskName: string): Promise<string> {
  await admin.goto("/manage/meer");
  // The desktop sidebar has a Kiosks item too: take the one in the page.
  await admin
    .getByRole("main")
    .getByRole("link", { name: "Kiosks", exact: true })
    .click();
  await expect(admin).toHaveURL(/\/manage\/meer\/kiosks$/);
  await button(admin, "Nieuwe kiosk").click();
  await admin.getByLabel("Locatie").selectOption({ label: KIOSK_SITE_NAME });
  await admin.getByLabel("Naam van de tablet").fill(kioskName);
  await button(admin, "Kiosk aanmaken").click();
  const codeText = admin.getByTestId("pairing-code");
  await expect(codeText).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, {
    timeout: 15_000,
  });
  await expect(admin.getByText(/Open op de tablet: .*\/kiosk\/koppelen/)).toBeVisible();
  return codeText.innerText();
}

/** The tablet side: from the unpaired screen to the name tiles. */
export async function pairTablet(
  tablet: Page,
  code: string,
  onScreen?: (name: "niet-gekoppeld" | "koppelen") => Promise<void>,
): Promise<void> {
  await tablet.goto("/kiosk");
  await expect(
    tablet.getByRole("heading", { name: "Deze tablet is nog niet gekoppeld" }),
  ).toBeVisible();
  await onScreen?.("niet-gekoppeld");
  await tablet.getByRole("link", { name: "Tablet koppelen" }).click();
  await expect(tablet).toHaveURL(/\/kiosk\/koppelen$/);
  await onScreen?.("koppelen");
  await tablet.getByLabel("Koppelcode").fill(code.toLowerCase());
  await button(tablet, "Koppelen").click();
  await expect(tablet).toHaveURL(/\/kiosk$/, { timeout: 15_000 });
}

/** Taps the employee's tile and types a PIN on the pad. */
export async function enterPin(tablet: Page, pin: string): Promise<void> {
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible();
  await button(tablet, KIOSK_EMPLOYEE_NAME).click();
  await expect(
    tablet.getByRole("heading", { name: "Voer je pincode in" }),
  ).toBeVisible();
  for (const digit of pin) await button(tablet, digit).click();
  await button(tablet, "OK").click();
}

/** Stops a break and/or work left open by an earlier run, via the kiosk. */
export async function ensureOff(tablet: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enterPin(tablet, KIOSK_PIN);
    await expect(
      tablet.getByRole("heading", { name: `Hallo ${KIOSK_FIRST_NAME}` }),
    ).toBeVisible();
    const open: string[] = [];
    for (const name of ["Verder werken", "Stop werk"]) {
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

/** Revokes the kiosk again (the kiosks page must be showing); asks twice. */
export async function revokeKiosk(admin: Page, kioskName: string): Promise<void> {
  await admin.reload();
  const item = admin.getByRole("row").filter({ hasText: kioskName });
  await item.getByRole("button", { name: "Beheren" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Intrekken" }).click();
  await admin
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ja, trek in" })
    .click();
  await expect(item.getByText("Ingetrokken")).toBeVisible({ timeout: 15_000 });
}
