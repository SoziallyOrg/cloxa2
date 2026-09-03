import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

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
    `correction.${projectName.replaceAll(/[^a-z0-9]/gu, ".")}.${randomUUID().slice(0, 20)}@example.test`,
  );
  const created = await admin.auth.admin.createUser({
    app_metadata: { cloxa_local_fixture: "cloxa-correction-e2e-v1" },
    email,
    email_confirm: true,
    password: employeePassword,
  });
  if (created.error || !created.data.user?.id) {
    throw new Error("Synthetic local correction account creation failed.");
  }

  const userId = created.data.user.id;
  const membership = await admin
    .from("memberships")
    .insert({
      employee_code: "E2E-CORRECTION",
      organization_id: localFixture.organization.id,
      role: "employee",
      status: "active",
      user_id: userId,
    })
    .select("id")
    .single();
  const profile = await admin.from("profiles").insert({
    display_name: "Fictieve correctiemedewerker",
    locale: "nl-BE",
    user_id: userId,
  });
  if (membership.error || !membership.data?.id || profile.error) {
    throw new Error("Synthetic local correction membership creation failed.");
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

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

function subtractWallMinutes(value: string, minutes: number) {
  const [localDate, localTime] = value.split(" ");
  const [day, month, year] = localDate!.split("/");
  const date = new Date(`${year}-${month}-${day}T${localTime!.slice(0, 5)}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

test("medewerker dient correcties idempotent in en trekt eigen aanvraag in", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createSyntheticEmployee(testInfo.project.name);

  if (testInfo.project.name === "chromium-mobile") {
    await page.setViewportSize({ height: 800, width: 320 });
  }
  await login(page, fixture.email);

  await page.getByRole("button", { name: "Start werk", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop werk", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop werk", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start werk", exact: true }),
  ).toBeEnabled();

  const original = await fixture.admin
    .from("time_entries")
    .select("id,started_at,ended_at")
    .eq("membership_id", fixture.membershipId)
    .single();
  if (original.error || !original.data?.ended_at) {
    throw new Error("Synthetic closed time entry missing.");
  }

  await page.getByRole("link", { name: "Correctie aanvragen" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/employee/corrections");
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText("Je hebt nog geen correctieaanvragen.")).toBeVisible();
  await expect(page.getByTestId("closed-entries").locator("li")).toHaveCount(1);

  await page
    .getByTestId("closed-entries")
    .getByRole("button", { name: "Correctie aanvragen" })
    .click();
  const adjustmentForm = page.getByTestId("correction-form");
  await expect(adjustmentForm.getByRole("heading")).toBeFocused();
  await adjustmentForm.getByRole("button", { name: "Formulier sluiten" }).click();
  const reopen = page
    .getByTestId("closed-entries")
    .getByRole("button", { name: "Correctie aanvragen" });
  await expect(reopen).toBeFocused();
  await expect(reopen).toHaveAttribute("aria-expanded", "false");
  await reopen.click();
  await expect(reopen).toHaveAttribute("aria-expanded", "true");
  const startInput = adjustmentForm.getByLabel("Voorgestelde start");
  const endInput = adjustmentForm.getByLabel("Voorgesteld einde");
  const initialStart = await startInput.inputValue();
  expect(await endInput.inputValue()).not.toBe("");
  await startInput.fill(subtractWallMinutes(initialStart, 15));
  const escapedReason = "Starttijd was onjuist. <strong>Geen HTML</strong>";
  await adjustmentForm.getByLabel("Reden").fill(escapedReason);

  const submitButton = adjustmentForm.getByRole("button", {
    name: "Aanvraag indienen",
  });
  await submitButton.evaluate((button) => {
    const form = (button as HTMLButtonElement).form;
    if (!form) throw new Error("Correction form missing");
    form.requestSubmit(button as HTMLButtonElement);
    form.requestSubmit(button as HTMLButtonElement);
  });

  await expect
    .poll(async () => {
      const requests = await fixture.admin
        .from("correction_requests")
        .select("id,status")
        .eq("employee_membership_id", fixture.membershipId);
      const audits = await fixture.admin
        .from("audit_events")
        .select("id")
        .eq("actor_user_id", fixture.userId)
        .eq("action", "correction_request.submitted");
      return {
        audits: audits.data?.length ?? -1,
        requests: requests.data?.length ?? -1,
      };
    })
    .toEqual({ audits: 1, requests: 1 });
  await expect(page.getByText(escapedReason, { exact: true })).toBeVisible();
  await expect(page.locator("strong")).toHaveCount(0);
  await expect(page.getByText("In afwachting", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(escapedReason, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const withdrawButton = page.getByRole("button", {
    name: "Aanvraag intrekken",
  });
  await withdrawButton.evaluate((button) => {
    const form = (button as HTMLButtonElement).form;
    if (!form) throw new Error("Withdrawal form missing");
    form.requestSubmit(button as HTMLButtonElement);
    form.requestSubmit(button as HTMLButtonElement);
  });
  await expect(page.getByText("Ingetrokken", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const audits = await fixture.admin
        .from("audit_events")
        .select("id")
        .eq("actor_user_id", fixture.userId)
        .eq("action", "correction_request.withdrawn");
      return audits.data?.length ?? -1;
    })
    .toBe(1);

  await page.getByRole("button", { name: "Ontbrekende registratie melden" }).click();
  const missedForm = page.getByTestId("correction-form");
  await missedForm.getByLabel("Voorgestelde start").fill("30/03/2025 02:30");
  await missedForm.getByLabel("Voorgesteld einde").fill("30/03/2025 04:00");
  await missedForm.getByLabel("Reden").fill("Controle van lentetijd.");
  await missedForm.getByRole("button", { name: "Aanvraag indienen" }).click();
  await expect(missedForm.getByLabel("Voorgestelde start")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await missedForm.getByLabel("Voorgestelde start").fill("26/10/2025 02:30");
  await missedForm.getByLabel("Voorgesteld einde").fill("26/10/2025 04:00");
  await missedForm.getByLabel("Reden").fill("Controle van herfsttijd.");
  await missedForm.getByRole("button", { name: "Aanvraag indienen" }).click();
  await expect(missedForm.getByLabel("Starttijd komt voor de")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(missedForm.getByLabel("Eindtijd komt voor de")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await missedForm.getByLabel("Voorgestelde start").fill("10/02/2025 09:00");
  await missedForm.getByLabel("Voorgesteld einde").fill("10/02/2025 10:00");
  await missedForm.getByLabel("Reden").fill("Registratie volledig vergeten.");
  await missedForm.getByRole("button", { name: "Aanvraag indienen" }).click();
  await expect(page.getByText("Registratie volledig vergeten.")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("correction-requests").locator("li")).toHaveCount(2);
  await expect(page.getByText("Ingetrokken", { exact: true })).toBeVisible();
  await expect(page.getByText("In afwachting", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const unchanged = await fixture.admin
    .from("time_entries")
    .select("id,started_at,ended_at")
    .eq("id", original.data.id)
    .single();
  expect(unchanged.error).toBeNull();
  expect(unchanged.data).toEqual(original.data);

  const adjustment = await fixture.admin
    .from("correction_requests")
    .select("proposed_ended_at")
    .eq("target_time_entry_id", original.data.id)
    .single();
  expect(adjustment.data?.proposed_ended_at).toBe(original.data.ended_at);

  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await page.getByRole("button", { name: "Ontbrekende registratie melden" }).click();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      fullPage: true,
      path:
        testInfo.project.name === "chromium-mobile"
          ? ".impeccable/review/mobile.png"
          : ".impeccable/review/desktop.png",
    });
  }
});

test("parallelle RPCs serialiseren aanvragen, intrekkingen en tijdklok", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createSyntheticEmployee(testInfo.project.name);
  const clients = await Promise.all(
    [0, 1].map(async () => {
      const client = createClient(
        supabaseOrigin,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
          global: { fetch: localOnlyFetch },
        },
      );
      const result = await client.auth.signInWithPassword({
        email: fixture.email,
        password: employeePassword,
      });
      if (result.error)
        throw new Error("Synthetic concurrent session creation failed.");
      return client;
    }),
  );
  const payload = {
    request_id: randomUUID(),
    request_kind: "missed_entry",
    target_time_entry_id: "",
    proposed_start_local: "2025-02-10T09:00",
    proposed_start_occurrence: "",
    proposed_end_local: "2025-02-10T10:00",
    proposed_end_occurrence: "",
    employee_reason: "Gelijktijdige lokale test.",
  };
  const submissions = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      clients[index % 2].rpc("submit_employee_correction_request", payload),
    ),
  );
  for (const result of submissions) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual(submissions[0].data);
  }
  const correctionId = submissions[0].data[0].correction_request_id;
  const changed = await clients[0].rpc("submit_employee_correction_request", {
    ...payload,
    employee_reason: "Gewijzigd.",
  });
  expect(changed.error?.message).toBe("correction_request_id_reused");

  const withdrawalId = randomUUID();
  const withdrawals = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      clients[index % 2].rpc("withdraw_employee_correction_request", {
        request_id: withdrawalId,
        correction_request_id: correctionId,
      }),
    ),
  );
  for (const result of withdrawals) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual(withdrawals[0].data);
  }
  const replay = await clients[1].rpc("submit_employee_correction_request", payload);
  expect(replay.data).toEqual(submissions[0].data);

  const conflicts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      clients[index % 2].rpc("submit_employee_correction_request", {
        ...payload,
        request_id: randomUUID(),
      }),
    ),
  );
  expect(conflicts.filter((result) => !result.error)).toHaveLength(1);
  expect(
    conflicts.filter(
      (result) => result.error?.message === "correction_pending_conflict",
    ),
  ).toHaveLength(7);

  const acceptedId = conflicts.find((result) => !result.error)!.data[0]
    .correction_request_id;
  const differentWithdrawals = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      clients[index % 2].rpc("withdraw_employee_correction_request", {
        request_id: randomUUID(),
        correction_request_id: acceptedId,
      }),
    ),
  );
  expect(differentWithdrawals.every((result) => !result.error)).toBe(true);
  expect(
    differentWithdrawals.filter((result) => result.data[0].did_withdraw),
  ).toHaveLength(1);

  const mixed = await Promise.all([
    clients[0].rpc("clock_in", { request_id: randomUUID() }),
    clients[1].rpc("submit_employee_correction_request", {
      ...payload,
      request_id: randomUUID(),
    }),
  ]);
  expect(mixed.map((result) => result.error)).toEqual([null, null]);
  const stopped = await clients[1].rpc("clock_out", { request_id: randomUUID() });
  expect(stopped.error).toBeNull();
  const facts = await fixture.admin
    .from("time_entries")
    .select("id,ended_at")
    .eq("membership_id", fixture.membershipId);
  expect(facts.data).toHaveLength(1);
  expect(facts.data[0].ended_at).not.toBeNull();
  const audits = await fixture.admin
    .from("audit_events")
    .select("action,before_data,after_data")
    .eq("actor_user_id", fixture.userId)
    .in("action", ["correction_request.submitted", "correction_request.withdrawn"]);
  expect(
    audits.data.filter((row) => row.action === "correction_request.submitted"),
  ).toHaveLength(3);
  expect(
    audits.data.filter((row) => row.action === "correction_request.withdrawn"),
  ).toHaveLength(2);
  expect(
    audits.data.every((row) => Object.keys(row.after_data).join() === "status"),
  ).toBe(true);
  await Promise.all(clients.map((client) => client.auth.signOut()));
});
