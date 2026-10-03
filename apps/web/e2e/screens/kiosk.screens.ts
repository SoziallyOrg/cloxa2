import { expect, test, type Page } from "@playwright/test";

import {
  button,
  createKiosk,
  enrolAdminTotp,
  ensureOff,
  enterPin,
  KIOSK_EMPLOYEE_NAME,
  KIOSK_PIN,
  KIOSK_WRONG_PIN,
  newActorPage,
  pairTablet,
  revokeKiosk,
  setKioskPin,
} from "../kiosk-support";
import { captureAt, SETTLED, TABLET_VIEWPORTS } from "./helpers";

/**
 * Design-review screenshots of the shared tablet (`pnpm screens`), landscape
 * and portrait. Uses the dedicated kiosk accounts (see kiosk-support.ts); the
 * kiosk made here is revoked again at the end.
 */
const shot = (page: Page, name: string) =>
  captureAt(page, `kiosk-${name}`, TABLET_VIEWPORTS, false);

const clockHeading = (page: Page) => page.getByRole("heading", { name: /^Hallo / });

test.use({ actionTimeout: 30_000 });

test("the shared tablet, from pairing to lock-out", async ({ browser }) => {
  test.setTimeout(600_000);
  const admin = await newActorPage(browser, {
    locale: "nl-BE",
    timezoneId: "Europe/Brussels",
  });
  const kioskName = `Screens tablet ${Date.now()}`;
  await enrolAdminTotp(admin);
  await setKioskPin(admin);
  const code = await createKiosk(admin, kioskName);

  const tablet = await newActorPage(browser, {
    locale: "nl-BE",
    timezoneId: "Europe/Brussels",
    viewport: TABLET_VIEWPORTS["tablet-liggend"],
  });

  await pairTablet(tablet, code, async (screen) => {
    await shot(tablet, screen);
  });

  // A wrong pairing code is refused in words.
  await tablet.goto("/kiosk/koppelen");
  await tablet.getByLabel("Koppelcode").fill("ZZZZ-ZZZZ");
  await button(tablet, "Koppelen").click();
  await expect(tablet.getByRole("alert")).toBeVisible(SETTLED);
  await shot(tablet, "koppelen-fout");
  await tablet.goto("/kiosk");

  await ensureOff(tablet);
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible();
  await shot(tablet, "namen");

  // The pad: empty, half typed, a wrong PIN.
  await button(tablet, KIOSK_EMPLOYEE_NAME).click();
  await expect(
    tablet.getByRole("heading", { name: "Voer je pincode in" }),
  ).toBeVisible();
  await shot(tablet, "pincode");
  for (const digit of "25") await button(tablet, digit).click();
  await shot(tablet, "pincode-ingevuld");
  await button(tablet, "Terug").click();
  await enterPin(tablet, KIOSK_WRONG_PIN);
  await expect(tablet.getByText("Deze pincode klopt niet.")).toBeVisible(SETTLED);
  await shot(tablet, "pincode-fout");
  await button(tablet, "Terug").click();

  // Not working: Start werk (light block), then the forest confirmation.
  await enterPin(tablet, KIOSK_PIN);
  await expect(clockHeading(tablet)).toBeVisible(SETTLED);
  await shot(tablet, "actie-uit");
  await button(tablet, "Start werk").click();
  await expect(tablet.getByText(/^Gestart om /)).toBeVisible(SETTLED);
  await shot(tablet, "klaar-gestart");
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible({
    timeout: 10_000,
  });

  // Working (forest): Pauze nemen, then the amber confirmation.
  await enterPin(tablet, KIOSK_PIN);
  await expect(clockHeading(tablet)).toBeVisible(SETTLED);
  await shot(tablet, "actie-werkt");
  await button(tablet, "Pauze nemen").click();
  await expect(tablet.getByText(/^Pauze gestart om /)).toBeVisible(SETTLED);
  await shot(tablet, "klaar-pauze");
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible({
    timeout: 10_000,
  });

  // On pause (amber): Verder werken, then the forest confirmation.
  await enterPin(tablet, KIOSK_PIN);
  await expect(clockHeading(tablet)).toBeVisible(SETTLED);
  await shot(tablet, "actie-pauze");
  await button(tablet, "Verder werken").click();
  await expect(tablet.getByText(/^Pauze gestopt om /)).toBeVisible(SETTLED);
  await shot(tablet, "klaar-verder");
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible({
    timeout: 10_000,
  });

  // Working again: Stop werk, then the grey confirmation.
  await enterPin(tablet, KIOSK_PIN);
  await expect(clockHeading(tablet)).toBeVisible(SETTLED);
  await button(tablet, "Stop werk").click();
  await expect(tablet.getByText(/^Gestopt om /)).toBeVisible(SETTLED);
  await shot(tablet, "klaar-gestopt");
  await expect(tablet.getByRole("heading", { name: "Kies je naam" })).toBeVisible({
    timeout: 10_000,
  });

  // Too many wrong PINs: the lock-out (lifted again by the next setKioskPin).
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await enterPin(tablet, KIOSK_WRONG_PIN);
    const alert = tablet.getByRole("alert").filter({ hasText: /pincode/i });
    await expect(alert).toBeVisible(SETTLED);
    if (/te veel verkeerde pincodes/i.test(await alert.innerText())) break;
    await button(tablet, "Terug").click();
  }
  await shot(tablet, "pincode-geblokkeerd");

  // Revoked: the tablet says so.
  await revokeKiosk(admin, kioskName);
  await tablet.goto("/kiosk");
  await expect(
    tablet.getByRole("heading", { name: "Deze tablet is niet meer gekoppeld" }),
  ).toBeVisible();
  await shot(tablet, "ingetrokken");
});
