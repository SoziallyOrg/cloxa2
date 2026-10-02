import { execSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { nextTotpStep, totp } from "../support";
import {
  button,
  capture,
  captureMid,
  captureScrolled,
  MID_VIEWPORT,
  closeSheet,
  enrol,
  previewState,
  SETTLED,
  VIEWPORTS,
} from "./helpers";

/**
 * Design-review screenshots of `/manage` (`pnpm screens`), at phone and
 * desktop size. Not a test of behaviour: the e2e specs do
 * that.
 *
 * `screens-beheer@demo.test` owns "Bakkerij Zon (fictief)", an organization
 * of its own that `dev:seed` brings to a realistic "today" on every run
 * (see seedManagerScreens). `screens-beheer-leeg@demo.test` owns an empty
 * one. Both are reserved for the screens, so resetting their MFA is safe.
 * Nothing here decides a request or changes the team: reruns look the same.
 */
const OWNER = "screens-beheer@demo.test";
const EMPTY_OWNER = "screens-beheer-leeg@demo.test";
const DETAIL = "Amina Peeters";
const FORGOT = "Driss Aerts";
const LEFT = "Pieter Wouters";

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const dialog = (page: Page) => page.getByRole("dialog");
/** The timeline is in the markup twice (table and grouped list); one is hidden. */
const visibleText = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

/** A page with its data held back: the streamed `loading.tsx`. */
async function captureLoading(page: Page, path: string, name: string): Promise<void> {
  await previewState(page, "laden");
  await page.goto(path, { waitUntil: "commit" });
  await expect(page.getByText("Bezig met laden", { exact: true }).first()).toBeAttached(
    SETTLED,
  );
  await capture(page, name, false);
  await previewState(page, null);
}

async function open(page: Page, path: string, title: string | RegExp): Promise<void> {
  await page.goto(path);
  await expect(heading(page)).toHaveText(title, SETTLED);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(240_000);
  // Local-only (the seed refuses anything but loopback): resets "today".
  execSync("pnpm --filter @cloxa/web dev:seed", { stdio: "inherit" });
});

test("the manager area of a bakery with a team", async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize(VIEWPORTS.phone);
  const secret = await enrol(page, OWNER, true);

  // Vandaag: the numbers, the timeline, the site filter.
  await expect(heading(page)).toHaveText("Vandaag");
  await expect(visibleText(page, FORGOT)).toBeVisible();
  await capture(page, "beheer-vandaag");
  await captureScrolled(page, "beheer-vandaag-ingeklapt");

  // 1100px: the timeline has the full width, the panel is a sheet.
  await captureMid(page, "beheer-vandaag");
  await page.setViewportSize(MID_VIEWPORT);
  await page.getByRole("button", { name: /^Aanvragen/ }).click();
  await expect(dialog(page)).toBeVisible();
  await captureMid(page, "beheer-vandaag-aanvragen", false);
  await closeSheet(page);
  await page.getByRole("button", { name: new RegExp(`^${FORGOT}`) }).click();
  await expect(dialog(page)).toBeVisible();
  await captureMid(page, "beheer-vandaag-persoon", false);
  await closeSheet(page);
  await page.setViewportSize(VIEWPORTS.phone);
  await page.getByRole("button", { name: new RegExp(`^${FORGOT}`) }).click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-vandaag-aandacht", false);
  await closeSheet(page);
  await page.getByRole("button", { name: /^Locatie:/ }).click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-vandaag-locatie", false);
  await dialog(page).getByRole("button", { name: "Filiaal Station (fictief)" }).click();
  await expect(page).toHaveURL(/\?site=/, SETTLED);
  await expect(visibleText(page, "Mohamed El Idrissi")).toBeVisible(SETTLED);
  await capture(page, "beheer-vandaag-filiaal");

  // The account sheet from the sidebar (desktop only has the sidebar).
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/manage");
  await page.getByRole("complementary").first().getByRole("button").click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-account", false);
  await closeSheet(page);
  await page.setViewportSize(VIEWPORTS.phone);

  // Aanvragen: open, the reject sheet, decided.
  await open(page, "/manage/vragen", "Aanvragen");
  await capture(page, "beheer-aanvragen");
  await page.getByRole("button", { name: "Weigeren", exact: true }).first().click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-aanvragen-afwijzen", false);
  await closeSheet(page);
  await open(page, "/manage/vragen?tab=decided", "Aanvragen");
  await capture(page, "beheer-aanvragen-behandeld");

  // Team: the segments, search, the invite sheet.
  await open(page, "/manage/team", "Team");
  await capture(page, "beheer-team");
  await captureMid(page, "beheer-team");
  await page.setViewportSize(MID_VIEWPORT);
  await page.getByRole("button", { name: `Samenvatting van ${DETAIL}` }).click();
  await expect(dialog(page)).toBeVisible();
  await captureMid(page, "beheer-team-samenvatting", false);
  await closeSheet(page);
  await page.setViewportSize(VIEWPORTS.phone);
  await page.getByRole("searchbox").fill("zzz");
  await expect(page.getByText(/^Niemand gevonden/)).toBeVisible();
  await capture(page, "beheer-team-zoeken");
  await button(page, "Uitnodigen").click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-team-uitnodigen", false);
  await closeSheet(page);
  await open(page, "/manage/team?toon=uitgenodigd", "Team");
  await capture(page, "beheer-team-uitgenodigd");
  await open(page, "/manage/team?toon=uit-dienst", "Team");
  await capture(page, "beheer-team-uit-dienst");

  // One employee: the page, the PIN sheet, signing out, and "Uit dienst".
  await open(page, "/manage/team", "Team");
  await page.getByRole("link", { name: new RegExp(`^${DETAIL}`) }).click();
  await expect(heading(page)).toHaveText(DETAIL, SETTLED);
  const detailUrl = page.url();
  await capture(page, "beheer-medewerker");
  await page.getByRole("button", { name: /^Kiosk-pincode/ }).click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-medewerker-pincode", false);
  await closeSheet(page);
  await button(page, "Overal afmelden").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await capture(page, "beheer-medewerker-afmelden", false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await button(page, "Uit dienst").click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-medewerker-uit-dienst", false);
  await closeSheet(page);

  // The schedule editor, from the employee.
  await page.getByRole("link", { name: "Rooster aanpassen" }).click();
  await expect(heading(page)).toHaveText("Rooster aanpassen", SETTLED);
  const scheduleUrl = page.url();
  await capture(page, "beheer-rooster");

  await open(page, "/manage/team", "Team");
  await page.getByRole("link", { name: new RegExp(`^${FORGOT}`) }).click();
  await expect(heading(page)).toHaveText(FORGOT, SETTLED);
  await capture(page, "beheer-medewerker-vergeten");
  await open(page, "/manage/team?toon=uit-dienst", "Team");
  await page.getByRole("link", { name: new RegExp(`^${LEFT}`) }).click();
  await expect(heading(page)).toHaveText(LEFT, SETTLED);
  await capture(page, "beheer-medewerker-uit-dienst-persoon");

  // Exports.
  await open(page, "/manage/meer/exports", "Exports");
  await capture(page, "beheer-exports");
  await page.getByRole("radio", { name: "Zelf kiezen" }).click();
  await capture(page, "beheer-exports-zelf-kiezen");

  // Meer and what hangs under it.
  await open(page, "/manage/meer", "Meer");
  await capture(page, "beheer-meer");
  await open(page, "/manage/meer/instellingen", "Instellingen");
  await capture(page, "beheer-instellingen");
  await open(page, "/manage/meer/kiosks", "Kiosks");
  await capture(page, "beheer-kiosks");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Tablet aan de ingang" })
    .getByRole("button")
    .click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-kiosks-acties", false);
  await dialog(page).getByRole("button", { name: "Nieuwe koppelcode" }).click();
  await expect(page.getByTestId("pairing-code")).toBeVisible(SETTLED);
  await capture(page, "beheer-kiosks-code", false);
  await closeSheet(page);
  await open(page, "/manage/meer/audit", "Activiteitenlog");
  await capture(page, "beheer-audit");
  await page.getByRole("button", { name: /^Controleer integriteit/ }).click();
  await expect(page.getByText("Alles klopt")).toBeVisible(SETTLED);
  await capture(page, "beheer-audit-controle");
  await button(page, "Filteren").click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-audit-filter", false);
  await closeSheet(page);

  // Loading skeletons: each page's data held back.
  await captureLoading(page, "/manage", "laden-beheer-vandaag");
  await captureLoading(page, "/manage/vragen", "laden-beheer-aanvragen");
  await captureLoading(page, "/manage/team", "laden-beheer-team");
  await captureLoading(page, detailUrl, "laden-beheer-medewerker");
  await captureLoading(page, scheduleUrl, "laden-beheer-rooster");
  await captureLoading(page, "/manage/meer/exports", "laden-beheer-exports");
  await captureLoading(page, "/manage/meer", "laden-beheer-meer");
  await captureLoading(page, "/manage/meer/instellingen", "laden-beheer-instellingen");
  await captureLoading(page, "/manage/meer/kiosks", "laden-beheer-kiosks");
  await captureLoading(page, "/manage/meer/audit", "laden-beheer-audit");

  // A page that fails to load.
  await previewState(page, "fout");
  await page.goto("/manage/team");
  await expect(button(page, "Opnieuw proberen")).toBeVisible(SETTLED);
  await capture(page, "fout-beheer");
  await previewState(page, null);

  // Idle: the check with the app again (the login style).
  await page.context().clearCookies({ name: "cx_act" });
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/manage\/beveiliging\/controle$/, SETTLED);
  await capture(page, "beheer-mfa-controle");
  await nextTotpStep(page);
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig").click();
  await expect(page).toHaveURL(/\/manage$/, SETTLED);
});

test("a new organization with nothing in it yet", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORTS.phone);
  await enrol(page, EMPTY_OWNER, false);
  await expect(heading(page)).toHaveText("Vandaag");
  await capture(page, "beheer-leeg-vandaag");
  await open(page, "/manage/vragen", "Aanvragen");
  await expect(page.getByText("Alles is behandeld")).toBeVisible();
  await capture(page, "beheer-leeg-aanvragen");
  await open(page, "/manage/team?toon=uitgenodigd", "Team");
  await capture(page, "beheer-leeg-team-uitgenodigd");
  await open(page, "/manage/meer/exports", "Exports");
  await capture(page, "beheer-leeg-exports");
  await open(page, "/manage/meer/kiosks", "Kiosks");
  await capture(page, "beheer-leeg-kiosks");
});
