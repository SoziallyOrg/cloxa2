import { expect, test } from "@playwright/test";

import {
  button,
  createKiosk,
  enrolAdminTotp,
  ensureOff,
  enterPin,
  KIOSK_FIRST_NAME as FIRST_NAME,
  KIOSK_PIN as PIN,
  KIOSK_WRONG_PIN as WRONG_PIN,
  newActorPage,
  pairTablet,
  revokeKiosk,
  setKioskPin,
} from "./kiosk-support";
import { collectConsoleErrors } from "./support";

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
test("admin pairs a kiosk; an employee without login clocks in with a PIN", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await newActorPage(browser);
  const adminErrors = collectConsoleErrors(admin);
  const kioskName = `E2E tablet ${Date.now()}`;

  await enrolAdminTotp(admin);
  // The PIN, set by the admin: the way for staff without a login.
  await setKioskPin(admin);
  const code = await createKiosk(admin, kioskName);

  // The tablet: its own context, never signed in.
  const tablet = await newActorPage(browser);
  const tabletErrors = collectConsoleErrors(tablet);
  await pairTablet(tablet, code);

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
  await revokeKiosk(admin, kioskName);
  await tablet.reload();
  await expect(
    tablet.getByRole("heading", { name: "Deze tablet is niet meer gekoppeld" }),
  ).toBeVisible();

  expect(adminErrors).toEqual([]);
  expect(tabletErrors).toEqual([]);
});
