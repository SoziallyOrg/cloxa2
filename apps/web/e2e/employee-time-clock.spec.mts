import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { localFixture } from "../../../scripts/local-auth-bootstrap.mjs";
import {
  localOnlyFetch,
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
} from "../../../scripts/local-auth-config.mjs";

const appOrigin = requireLocalOrigin(process.env.CLOXA_SITE_URL, "App URL");
const supabaseOrigin = requireLocalOrigin(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "Supabase URL",
);
const employeePassword = requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
);
const requireFromWeb = createRequire(new URL("../package.json", import.meta.url));
const { createClient } = requireFromWeb("@supabase/supabase-js");

async function blockExternalRequests(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;

    if (![appOrigin, supabaseOrigin].includes(origin)) {
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });
}

function localAdmin() {
  return createClient(supabaseOrigin, process.env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: localOnlyFetch },
  });
}

async function createSyntheticEmployee(projectName: string) {
  const admin = localAdmin();
  const email = requireFictionalEmail(
    `clock.${projectName.replaceAll(/[^a-z0-9]/gu, ".")}.${randomUUID()}@example.test`,
  );
  const created = await admin.auth.admin.createUser({
    app_metadata: { cloxa_local_fixture: "cloxa-time-clock-e2e-v1" },
    email,
    email_confirm: true,
    password: employeePassword,
  });

  if (created.error || !created.data.user?.id) {
    throw new Error("Synthetic local time-clock account creation failed.");
  }

  const userId = created.data.user.id;
  const membership = await admin
    .from("memberships")
    .insert({
      employee_code: "E2E-CLOCK",
      organization_id: localFixture.organization.id,
      role: "employee",
      status: "active",
      user_id: userId,
    })
    .select("id")
    .single();
  const profile = await admin.from("profiles").insert({
    display_name: "Fictieve prikklokmedewerker",
    locale: "nl-BE",
    user_id: userId,
  });

  if (membership.error || !membership.data?.id || profile.error) {
    throw new Error("Synthetic local time-clock membership creation failed.");
  }

  return { admin, email, membershipId: membership.data.id, userId };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(employeePassword);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/employee");
}

async function expectDatabaseCounts(
  admin: ReturnType<typeof localAdmin>,
  membershipId: string,
  userId: string,
  expected: { clockIns: number; clockOuts: number; open: number; total: number },
) {
  await expect
    .poll(async () => {
      const entries = await admin
        .from("time_entries")
        .select("id,ended_at")
        .eq("membership_id", membershipId);
      const audits = await admin
        .from("audit_events")
        .select("action")
        .eq("actor_user_id", userId)
        .in("action", ["time_entry.clocked_in", "time_entry.clocked_out"]);

      if (entries.error || audits.error) {
        return null;
      }

      return {
        clockIns: audits.data.filter(
          (event: { action: string }) => event.action === "time_entry.clocked_in",
        ).length,
        clockOuts: audits.data.filter(
          (event: { action: string }) => event.action === "time_entry.clocked_out",
        ).length,
        open: entries.data.filter(
          (entry: { ended_at: string | null }) => entry.ended_at === null,
        ).length,
        total: entries.data.length,
      };
    })
    .toEqual(expected);
}

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

test("medewerker klokt veilig in en uit met retries, concurrency en reload", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await createSyntheticEmployee(testInfo.project.name);

  if (testInfo.project.name === "chromium-mobile") {
    await page.setViewportSize({ height: 800, width: 320 });
  }
  await login(page, fixture.email);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Je bent niet aan het werk", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vandaag zijn er nog geen registraties.")).toBeVisible();

  const startButton = page.getByRole("button", { name: "Start werk", exact: true });
  await expect(startButton).toBeEnabled();
  await expect(page.locator('input[name="request_id"]')).toHaveValue(
    /^[0-9a-f-]{36}$/u,
  );
  await startButton.evaluate((button) => {
    const form = (button as HTMLButtonElement).form;
    if (!form) throw new Error("Clock form missing");
    form.requestSubmit(button as HTMLButtonElement);
    form.requestSubmit(button as HTMLButtonElement);
  });

  await expectDatabaseCounts(fixture.admin, fixture.membershipId, fixture.userId, {
    clockIns: 1,
    clockOuts: 0,
    open: 1,
    total: 1,
  });
  await expect(
    page.getByRole("heading", { name: "Je bent aan het werk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Werkruimte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Aanmelden", exact: true })).toHaveCount(
    0,
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Je bent aan het werk", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("today-entries").locator("li")).toHaveCount(1);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await page.screenshot({
      fullPage: true,
      path: `.impeccable/review/employee-time-clock-${testInfo.project.name}.png`,
    });
  }

  const secondPage = await context.newPage();
  await secondPage.goto("/employee");
  await expect(
    secondPage.getByRole("button", { name: "Stop werk", exact: true }),
  ).toBeEnabled();

  await Promise.all([
    page.getByRole("button", { name: "Stop werk", exact: true }).click(),
    secondPage.getByRole("button", { name: "Stop werk", exact: true }).click(),
  ]);
  await expectDatabaseCounts(fixture.admin, fixture.membershipId, fixture.userId, {
    clockIns: 1,
    clockOuts: 1,
    open: 0,
    total: 1,
  });

  await Promise.all([page.reload(), secondPage.reload()]);
  await expect(
    page.getByRole("button", { name: "Start werk", exact: true }),
  ).toBeEnabled();
  await expect(
    secondPage.getByRole("button", { name: "Start werk", exact: true }),
  ).toBeEnabled();

  await Promise.all([
    page.getByRole("button", { name: "Start werk", exact: true }).click(),
    secondPage.getByRole("button", { name: "Start werk", exact: true }).click(),
  ]);
  await expectDatabaseCounts(fixture.admin, fixture.membershipId, fixture.userId, {
    clockIns: 2,
    clockOuts: 1,
    open: 1,
    total: 2,
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Je bent aan het werk", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop werk", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Je bent niet aan het werk", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("today-entries").locator("li")).toHaveCount(2);
  await expectDatabaseCounts(fixture.admin, fixture.membershipId, fixture.userId, {
    clockIns: 2,
    clockOuts: 2,
    open: 0,
    total: 2,
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Je bent niet aan het werk", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("today-entries").locator("li")).toHaveCount(2);
  await secondPage.close();
});
