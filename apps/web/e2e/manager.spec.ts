import { expect, test } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  nextTotpStep,
  resetFactors,
  totp,
} from "./support";

/**
 * Manager: email code, TOTP enrolment, idle re-verification, and no server
 * action at aal1. Uses a manager reserved for this test whose factors are
 * reset through the admin API first, so the test can run again and again.
 */
const MANAGER = "manager-e2e@demo.test";

test("manager enrols TOTP, re-verifies when idle, and cannot post actions at aal1", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const consoleErrors = collectConsoleErrors(page);
  await resetFactors(MANAGER);

  await loginWithEmailCode(page, MANAGER);
  // aal1 without a factor: straight to setup.
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);

  // An aal1 session posting a server action straight at /manage is turned away
  // before it runs, with a 303 (never a replayed POST). The page's own "start
  // enrolment" action is the probe: it's the only live action id we can get
  // our hands on while JS drives the form (progressive-enhancement hidden
  // fields no longer exist once a form is behind a client action). We
  // capture the exact request the browser makes when clicking the button,
  // then replay its Next-Action id and body at /manage instead of at this
  // page, to prove the guard fires for any action, not just this one.
  const startRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.headers()["next-action"] !== undefined,
  );
  await page.getByRole("button", { name: "Start met instellen" }).click();
  const captured = await startRequest;
  // The real click went ahead as normal: enrolment is under way. Read the
  // secret now, since the probe below deliberately never touches this tab's
  // in-memory state.
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");

  const nextAction = captured.headers()["next-action"];
  const contentType = captured.headers()["content-type"];
  expect(nextAction).toMatch(/^[0-9a-f]{16,}$/i);
  const denied = await page.request.post("/manage", {
    headers: {
      "Next-Action": nextAction!,
      "Content-Type": contentType!,
      Origin: baseURL!,
    },
    data: captured.postDataBuffer() ?? undefined,
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(303);
  expect(denied.headers()["location"]).toMatch(/\/manage\/beveiliging\/controle$/);

  // A real browser navigation is turned away the same way. A second tab, so
  // this doesn't reset the enrolment already in progress above.
  const probeTab = await page.context().newPage();
  await probeTab.goto("/manage");
  await expect(probeTab).toHaveURL(/\/manage\/beveiliging\/instellen$/);
  await probeTab.close();

  await page.getByLabel("Code uit je app").fill("000000");
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  // Local GoTrue can take several seconds for a TOTP challenge.
  await expect(page.getByText("Deze code klopt niet")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vandaag");

  // Idle: without a valid activity cookie the next visit needs the app again.
  await page.context().clearCookies({ name: "cx_act" });
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/manage\/beveiliging\/controle$/);
  await nextTotpStep(page);
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestig", exact: true }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });

  // A tampered activity cookie counts as idle too.
  const activity = (await page.context().cookies()).find(
    (cookie) => cookie.name === "cx_act",
  );
  expect(activity?.httpOnly).toBe(true);
  await page.context().addCookies([{ ...activity!, value: `${activity!.value}x` }]);
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/manage\/beveiliging\/controle$/);
  expect(consoleErrors).toEqual([]);
});
