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
const ACTION_FIELD = /^\$ACTION_ID_/;

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
  // before it runs, with a 303 (never a replayed POST). The page's logout
  // action is the probe: had it run, the session would be gone.
  const field = await page
    .locator('form input[type="hidden"]')
    .evaluateAll(
      (inputs) =>
        inputs
          .map((input) => input.getAttribute("name"))
          .find((name) => name?.startsWith("$ACTION_ID_")) ?? null,
    );
  expect(field).toMatch(ACTION_FIELD);
  const denied = await page.request.post("/manage", {
    headers: { "Next-Action": field!.replace(ACTION_FIELD, ""), Origin: baseURL! },
    multipart: { [field!]: "" },
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(303);
  expect(denied.headers()["location"]).toMatch(/\/manage\/beveiliging\/controle$/);
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/);

  // Enrolment: a wrong code first, then the real one.
  await page.getByRole("button", { name: "Start met instellen" }).click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill("000000");
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  // Local GoTrue can take several seconds for a TOTP challenge.
  await expect(page.getByText("Deze code klopt niet")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestig en ga verder" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beheer");

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
