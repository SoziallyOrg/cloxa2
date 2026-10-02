import { execSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { loginWithEmailCode, resetFactors, totp } from "../support";
import {
  button,
  capture,
  closeSheet,
  previewState,
  SETTLED,
  VIEWPORTS,
} from "./helpers";

/**
 * Design-review screenshots of the modules (ADR 008), at phone and desktop
 * size. Not a test of behaviour: modules.spec.ts does that.
 *
 * `screens-modules@demo.test` owns "Kantoor Verbeke (fictief)", an
 * organization of its own with four modules on (flexi off), a student with a
 * year of afternoons and an interim worker (see seedModules in dev-seed.ts),
 * so the other screens never show a module. Nothing here changes a setting
 * or clocks: the "Start werk" question is closed without an answer.
 */
const OWNER = "screens-modules@demo.test";
const STUDENT = "screens-modules-student@demo.test";
const STUDENT_NAME = "Lena Vermeiren";
const INTERIM_NAME = "Yusuf Demir";

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const dialog = (page: Page) => page.getByRole("dialog");

async function enrol(page: Page): Promise<void> {
  await resetFactors(OWNER);
  await loginWithEmailCode(page, OWNER);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/, SETTLED);
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible(SETTLED);
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, SETTLED);
}

async function open(page: Page, path: string, title: string | RegExp): Promise<void> {
  await page.goto(path);
  await expect(heading(page)).toHaveText(title, SETTLED);
}

async function captureLoading(page: Page, path: string, name: string): Promise<void> {
  await previewState(page, "laden");
  await page.goto(path, { waitUntil: "commit" });
  await expect(page.getByText("Bezig met laden", { exact: true }).first()).toBeAttached(
    SETTLED,
  );
  await capture(page, name, false);
  await previewState(page, null);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(240_000);
  // Local-only (the seed refuses anything but loopback): resets "today".
  execSync("pnpm --filter @cloxa/web dev:seed", { stdio: "inherit" });
});

test("modules for the owner: the list, a module, two people and the exports", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize(VIEWPORTS.phone);
  await enrol(page);

  // Meer, Modules: a group per module, then the CIAO line.
  await open(page, "/manage/meer/modules", "Modules");
  await expect(
    page.getByRole("switch", { name: "Thuiswerk gebruiken" }),
  ).toHaveAttribute("aria-checked", "true");
  await capture(page, "beheer-modules");

  // One module with a setting: the overuren sector.
  await page.getByRole("link", { name: /^Sector/ }).click();
  await expect(heading(page)).toHaveText("Vrijwillige overuren", SETTLED);
  const moduleUrl = page.url();
  await capture(page, "beheer-module-overuren");
  // And one without.
  await open(page, "/manage/meer/modules/telework", "Thuiswerk");
  await capture(page, "beheer-module-thuiswerk");

  // The student: counters, quarters, fields; and the fields sheet.
  await open(page, "/manage/team", "Team");
  await page.getByRole("link", { name: new RegExp(`^${STUDENT_NAME}`) }).click();
  await expect(heading(page)).toHaveText(STUDENT_NAME, SETTLED);
  const studentUrl = page.url();
  await expect(page.getByTestId("module-student")).toBeVisible();
  await capture(page, "beheer-medewerker-student");
  await page
    .getByTestId("module-student")
    .getByRole("button", { name: /^Gegevens aanpassen/ })
    .click();
  await expect(dialog(page)).toBeVisible();
  await capture(page, "beheer-medewerker-student-gegevens", false);
  await closeSheet(page);

  // The interim worker: the agency fields.
  await open(page, "/manage/team", "Team");
  await page.getByRole("link", { name: new RegExp(`^${INTERIM_NAME}`) }).click();
  await expect(heading(page)).toHaveText(INTERIM_NAME, SETTLED);
  await expect(page.getByTestId("module-interim")).toBeVisible();
  await capture(page, "beheer-medewerker-interim");

  // Exports: the agency choice and an agency export in the list.
  await open(page, "/manage/meer/exports", "Exports");
  // The list is in the markup twice (soft list and table): one is hidden.
  await expect(
    page
      .getByText("Uitzendkantoor: Tempo Uitzend (fictief)")
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await capture(page, "beheer-exports-modules");

  // Loading skeletons.
  await captureLoading(page, "/manage/meer/modules", "laden-beheer-modules");
  await captureLoading(page, moduleUrl, "laden-beheer-module");
  await captureLoading(page, studentUrl, "laden-beheer-medewerker-student");
});

test("modules for the student: the counter in Uren and the question at Start werk", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(VIEWPORTS.phone);
  await loginWithEmailCode(page, STUDENT);
  await expect(page).toHaveURL(/\/app$/, SETTLED);

  await open(page, "/app/uren", "Mijn uren");
  await expect(page.getByTestId("module-student")).toBeVisible(SETTLED);
  await capture(page, "uren-student");

  // "Waar werk je vandaag?", closed without an answer: nothing is recorded.
  await page.goto("/app");
  await button(page, "Start werk").click();
  const ask = page.getByRole("dialog", { name: "Waar werk je vandaag?" });
  await expect(ask).toBeVisible(SETTLED);
  await capture(page, "klok-thuiswerk", false);
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(button(page, "Start werk")).toBeEnabled(SETTLED);
});
