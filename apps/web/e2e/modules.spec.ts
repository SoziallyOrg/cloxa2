import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  collectConsoleErrors,
  loginWithEmailCode,
  resetFactors,
  totp,
} from "./support";

/**
 * Modules (ADR 008), end to end, in "Modules Test (fictief)", an organization
 * of its own (see seedModules in dev-seed.ts), so no other spec ever meets a
 * module. The owner switches Studenten and Thuiswerk on and fills in the
 * student's hours elsewhere; the student sees the counter in Uren, starts
 * work at home, and the owner sees that shift marked "thuis". Idempotent: a
 * switch already on is turned off first, the student ends clocked out.
 */
const OWNER = "modules-owner-e2e@demo.test";
const STUDENT = "modules-e2e@demo.test";
const STUDENT_NAME = "Stijn Studenttest";
const SETTLED = { timeout: 20_000 };

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function newActorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function enrolOwner(page: Page): Promise<void> {
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

/** Turns a module on through its switch; one already on goes off first. */
async function switchOn(page: Page, label: string): Promise<void> {
  const toggle = page.getByRole("switch", { name: `${label} gebruiken` });
  const group = page.getByTestId(/^module-switch-/).filter({ has: toggle });
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(group.getByRole("status")).toHaveText("Opgeslagen.", SETTLED);
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(group.getByRole("status")).toHaveText("Opgeslagen.", SETTLED);
}

/** Brings the student to "off", whatever an earlier run left behind. */
async function ensureOff(page: Page): Promise<void> {
  const start = button(page, "Start werk");
  const stop = button(page, "Stop werk");
  const endBreak = button(page, "Stop pauze");
  await expect(start.or(stop).or(endBreak)).toBeVisible(SETTLED);
  if (await endBreak.isVisible()) {
    await endBreak.click();
    await expect(stop).toBeVisible(SETTLED);
  }
  if (await stop.isVisible()) {
    await stop.click();
    await expect(start).toBeVisible(SETTLED);
  }
}

test("owner turns on modules; a student's hours and a shift at home show up", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // 1. The owner switches Studenten and Thuiswerk on.
  const owner = await newActorPage(browser);
  const ownerErrors = collectConsoleErrors(owner);
  await enrolOwner(owner);
  await owner.goto("/manage/meer");
  await owner.getByRole("link", { name: "Modules" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText("Modules", SETTLED);
  await expect(owner.getByText("Cloxa registreert niet bij CIAO")).toBeVisible();
  await switchOn(owner, "Studenten");
  await switchOn(owner, "Thuiswerk");

  // 2. The student's hours elsewhere, on the employee page.
  await owner.goto("/manage/team");
  await owner.getByRole("link", { name: new RegExp(`^${STUDENT_NAME}`) }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText(
    STUDENT_NAME,
    SETTLED,
  );
  const section = owner.getByTestId("module-student");
  await section.getByRole("button", { name: /^Gegevens aanpassen/ }).click();
  const sheet = owner.getByRole("dialog");
  await sheet.getByLabel(/^Uren bij andere werkgevers/).fill("37,5");
  await sheet
    .getByLabel(/^Nagekeken op/)
    .fill(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(
        new Date(),
      ),
    );
  await sheet.getByRole("button", { name: "Bewaren" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0, SETTLED);
  await expect(section.getByText("37 u 30 min").first()).toBeVisible(SETTLED);

  // 3. The student sees the counter in Uren.
  const student = await newActorPage(browser);
  const studentErrors = collectConsoleErrors(student);
  await loginWithEmailCode(student, STUDENT);
  await expect(student).toHaveURL(/\/app$/, SETTLED);
  await student.goto("/app/uren");
  const counter = student.getByTestId("module-student");
  await expect(counter.getByText(/^Studentenuren in \d{4}$/)).toBeVisible(SETTLED);
  await expect(
    counter.getByText(/van het contingent van 650 u \(indicatief\)$/),
  ).toBeVisible();

  // 4. Start werk asks where: at home.
  await student.goto("/app");
  await ensureOff(student);
  await button(student, "Start werk").click();
  const ask = student.getByRole("dialog", { name: "Waar werk je vandaag?" });
  await expect(ask).toBeVisible(SETTLED);
  await ask.getByRole("button", { name: "Thuis", exact: true }).click();
  await expect(
    student.getByRole("status").filter({ hasText: /^Gestart om \d/ }),
  ).toBeVisible(SETTLED);
  await expect(button(student, "Stop werk")).toBeVisible(SETTLED);

  // 5. The owner sees the shift marked "thuis" (the newest shift comes first).
  await owner.reload();
  const shifts = owner
    .locator("section")
    .filter({ has: owner.getByRole("heading", { name: "Laatste 14 dagen" }) });
  await expect(shifts.getByRole("listitem").first()).toContainText("thuis", SETTLED);

  // 6. Clean up: the student stops work (no question on the way out).
  await button(student, "Stop werk").click();
  await expect(button(student, "Start werk")).toBeVisible(SETTLED);

  expect(ownerErrors).toEqual([]);
  expect(studentErrors).toEqual([]);
});
