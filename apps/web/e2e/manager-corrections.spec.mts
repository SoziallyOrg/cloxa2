import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  localOnlyFetch,
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
} from "../../../scripts/local-auth-config.mjs";
import {
  elevateManagerSession,
  enrollManagerMfa,
  finishManagerBrowserLogin,
} from "./manager-mfa-fixture.mts";

const appOrigin = requireLocalOrigin(process.env.CLOXA_SITE_URL, "App URL");
const supabaseOrigin = requireLocalOrigin(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "Supabase URL",
);
const password = requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
);
const requireFromWeb = createRequire(new URL("../package.json", import.meta.url));
const { createClient } = requireFromWeb("@supabase/supabase-js");
const options = {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { fetch: localOnlyFetch },
};
const admin = () =>
  createClient(supabaseOrigin, process.env.SUPABASE_SECRET_KEY, options);

async function protect(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    if (![appOrigin, supabaseOrigin].includes(new URL(route.request().url()).origin))
      return route.abort("blockedbyclient");
    await route.continue();
  });
}
function assertLocalUuid(value: string) {
  if (!/^[0-9a-f-]{36}$/u.test(value))
    throw new Error("Invalid synthetic fixture identifier.");
  return value;
}
function ownerSql(sql: string) {
  // Local Docker owner only, used for defensive drift/expiry fixtures, never RPC authorization.
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cloxa2",
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    {
      input: sql,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
async function createAccount(organizationId: string, role: "manager" | "employee") {
  const service = admin();
  const email = requireFictionalEmail(`review.${role}.${randomUUID()}@example.test`);
  const user = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { cloxa_local_fixture: "manager-review-v1" },
  });
  if (user.error || !user.data.user?.id)
    throw new Error("Synthetic review account failed.");
  const userId = user.data.user.id;
  const membership = await service
    .from("memberships")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
      // One employee per fresh test organization; managers need no employee code.
      employee_code:
        role === "employee"
          ? createHash("sha256")
              .update(
                `${organizationId}:${test.info().testId}:${test.info().repeatEachIndex}`,
              )
              .digest("hex")
              .slice(0, 32)
          : null,
    })
    .select("id")
    .single();
  const profile = await service
    .from("profiles")
    .insert({ user_id: userId, display_name: `Fictieve ${role} <b>tekst</b>` });
  if (membership.error || profile.error)
    throw new Error("Synthetic review membership failed.");
  return { email, userId, membershipId: membership.data.id };
}
async function session(email: string) {
  const client = createClient(
    supabaseOrigin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Synthetic review login failed.");
  if (email.includes(".manager.")) await elevateManagerSession(client, email);
  return client;
}
async function team() {
  const service = admin();
  const org = await service
    .from("organizations")
    .insert({
      name: "Fictieve correctiebeoordeling",
      lifecycle_status: "research_pilot",
    })
    .select("id")
    .single();
  if (org.error) throw new Error("Synthetic review organization failed.");
  const worksite = await service
    .from("worksites")
    .insert({
      organization_id: org.data.id,
      name: "Fictieve werkplek",
      timezone: "Europe/Brussels",
    })
    .select("id")
    .single();
  if (worksite.error) throw new Error("Synthetic review worksite failed.");
  const manager = await createAccount(org.data.id, "manager");
  const employee = await createAccount(org.data.id, "employee");
  const managerClient = createClient(
    supabaseOrigin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
  const managerLogin = await managerClient.auth.signInWithPassword({
    email: manager.email,
    password,
  });
  if (managerLogin.error) throw new Error("Synthetic review login failed.");
  await enrollManagerMfa(managerClient, manager.email);
  return {
    manager,
    employee,
    organizationId: org.data.id,
    worksiteId: worksite.data.id,
    managerClient,
    employeeClient: await session(employee.email),
    service,
  };
}
async function login(page: Page, email: string, role: "manager" | "employee") {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  if (role === "manager") {
    await finishManagerBrowserLogin(page, email);
    return;
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/${role}`);
}
function wallTime(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/u.exec(iso)?.[1];
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${fraction ? `.${fraction}` : ""}`;
}
async function closedEntry(fixture: Awaited<ReturnType<typeof team>>) {
  const start = await fixture.employeeClient.rpc("clock_in", {
    request_id: randomUUID(),
  });
  const stop = await fixture.employeeClient.rpc("clock_out", {
    request_id: randomUUID(),
  });
  if (start.error || stop.error)
    throw new Error("Synthetic closed clock entry failed.");
  return stop.data[0];
}
async function submit(
  fixture: Awaited<ReturnType<typeof team>>,
  fields: Record<string, string> = {},
) {
  const result = await fixture.employeeClient.rpc(
    "submit_employee_correction_request",
    {
      request_id: randomUUID(),
      request_kind: "missed_entry",
      target_time_entry_id: "",
      proposed_start_local: "2010-02-01T09:00",
      proposed_end_local: "2010-02-01T10:00",
      proposed_start_occurrence: "",
      proposed_end_occurrence: "",
      employee_reason: "Fictieve reden <script>geen HTML</script>",
      ...fields,
    },
  );
  if (result.error) throw new Error(`Synthetic request failed: ${result.error.code}`);
  return result.data[0].correction_request_id as string;
}
const decision = (
  id: string,
  intent = "approve",
  note = "",
  requestId = randomUUID(),
) => ({
  request_id: requestId,
  correction_request_id: id,
  decision: intent,
  manager_note: note,
});
async function reveal(page: Page, id: string) {
  const row = page.getByTestId(`review-${id}`);
  if (!(await row.locator("details").getAttribute("open"))) {
    const open = await row
      .locator("details")
      .evaluate((element) => (element as HTMLDetailsElement).open);
    if (!open) await row.locator("summary").click();
  }
  return row;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible())
    expect(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
}
test.beforeEach(async ({ context }) => {
  await protect(context);
});

test("manager beoordeelt exacte voorstellen; medewerker ziet feiten en uitleg", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const fixture = await team();
  if (testInfo.project.name === "chromium-mobile")
    await page.setViewportSize({ width: 320, height: 800 });
  await login(page, fixture.manager.email, "manager");
  await page.getByRole("link", { name: "Correcties beoordelen" }).click();
  await expect(page.getByText("Er zijn geen aanvragen in afwachting.")).toBeVisible();
  const original = await closedEntry(fixture);
  const proposedStart = new Date(
    Date.parse(original.started_at) - 900_000,
  ).toISOString();
  const adjustmentId = await submit(fixture, {
    request_kind: "adjustment",
    target_time_entry_id: original.time_entry_id,
    proposed_start_local: wallTime(proposedStart),
    proposed_end_local: wallTime(original.ended_at),
  });
  const rejectId = await submit(fixture);
  const missedId = await submit(fixture, {
    proposed_start_local: "2010-02-02T09:00",
    proposed_end_local: "2010-02-02T10:00",
  });
  const withdrawnId = await submit(fixture, {
    proposed_start_local: "2010-02-03T09:00",
    proposed_end_local: "2010-02-03T10:00",
  });
  expect(
    (
      await fixture.employeeClient.rpc("withdraw_employee_correction_request", {
        request_id: randomUUID(),
        correction_request_id: withdrawnId,
      })
    ).error,
  ).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "In afwachting (3)" })).toBeVisible();
  const row = await reveal(page, adjustmentId);
  await expect(
    row.getByText("Fictieve reden <script>geen HTML</script>"),
  ).toBeVisible();
  expect(await row.locator("script,b").count()).toBe(0);
  await noOverflow(page);
  expect(
    await page
      .getByRole("heading", { level: 1 })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: `.impeccable/review/${testInfo.project.name === "chromium-mobile" ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
  }
  const approveButton = row.getByRole("button", { name: "Goedkeuren", exact: true });
  await approveButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Voorstel goedkeuren?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(approveButton).toBeFocused();
  await approveButton.click();
  await dialog
    .getByLabel("Toelichting (optioneel)")
    .fill("Akkoord <strong>als tekst</strong>");
  await noOverflow(page);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1")
    await page.screenshot({
      path: `.impeccable/review/dialog-${testInfo.project.name === "chromium-mobile" ? "mobile" : "desktop"}.png`,
    });
  let releaseApproval: () => void = () => {};
  const approvalGate = new Promise<void>((resolve) => {
    releaseApproval = resolve;
  });
  let approvalPosts = 0;
  const gateApproval = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "POST") {
      approvalPosts++;
      await approvalGate;
    }
    await route.fallback();
  };
  await page.route("**/manager/corrections", gateApproval);
  try {
    await dialog
      .getByRole("button", { name: "Goedkeuren en toepassen" })
      .evaluate((button) => {
        const form = (button as HTMLButtonElement).form!;
        form.requestSubmit(button as HTMLButtonElement);
        form.requestSubmit(button as HTMLButtonElement);
      });
    await expect(
      dialog.getByRole("button", { name: "Beslissing opslaan…" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Annuleren" })).toBeDisabled();
    await expect(dialog.getByLabel("Toelichting (optioneel)")).toBeDisabled();
    await expect.poll(() => approvalPosts).toBe(1);
  } finally {
    releaseApproval();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "Aanvraag goedgekeurd." }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Aanvraag goedgekeurd." }),
  ).toBeFocused();
  await page.unroute("**/manager/corrections", gateApproval);
  await page.reload();
  const approved = await reveal(page, adjustmentId);
  await expect(approved.getByText("Goedgekeurd", { exact: true })).toBeVisible();
  await expect(approved.getByRole("button")).toHaveCount(0);
  await expect(approved.getByText("Akkoord <strong>als tekst</strong>")).toBeVisible();
  await (
    await reveal(page, rejectId)
  )
    .getByRole("button", { name: "Afwijzen", exact: true })
    .click();
  const rejectDialog = page.getByRole("dialog", { name: "Aanvraag afwijzen" });
  await rejectDialog.getByRole("button", { name: "Afwijzing bevestigen" }).click();
  await expect(rejectDialog.getByLabel("Reden van afwijzing")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(rejectDialog.getByRole("alert")).toBeFocused();
  await rejectDialog
    .getByLabel("Reden van afwijzing")
    .fill("Andere dag gewerkt. <img src=x onerror=alert(1)>");
  await rejectDialog.getByRole("button", { name: "Afwijzing bevestigen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Aanvraag afgewezen." }),
  ).toBeVisible();
  await (
    await reveal(page, missedId)
  )
    .getByRole("button", { name: "Goedkeuren", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Goedkeuren en toepassen" })
    .click();
  await expect(page.getByText("Er zijn geen aanvragen in afwachting.")).toBeVisible();
  await expect(
    (await reveal(page, withdrawnId)).getByText("Ingetrokken", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);

  const employeeContext = await browser.newContext({
    viewport: {
      width: testInfo.project.name === "chromium-mobile" ? 320 : 1280,
      height: 800,
    },
  });
  await protect(employeeContext);
  const employeePage = await employeeContext.newPage();
  await login(employeePage, fixture.employee.email, "employee");
  await employeePage.goto("/employee/corrections");
  await expect(
    employeePage
      .getByTestId("correction-requests")
      .getByText("Goedgekeurd", { exact: true }),
  ).toHaveCount(2);
  await expect(
    employeePage.getByText("Andere dag gewerkt. <img src=x onerror=alert(1)>"),
  ).toBeVisible();
  await expect(
    employeePage.getByTestId("correction-requests").locator("img,strong,script"),
  ).toHaveCount(0);
  await expect(employeePage.getByTestId("closed-entries").locator("li")).toHaveCount(2);
  await noOverflow(employeePage);
  const facts = await fixture.service
    .from("time_entries")
    .select("id,started_at,ended_at,version,origin,last_correction_request_id")
    .eq("membership_id", fixture.employee.membershipId);
  expect(facts.error).toBeNull();
  expect(facts.data).toHaveLength(2);
  expect(
    Date.parse(
      facts.data.find((entry: { id: string }) => entry.id === original.time_entry_id)
        .started_at,
    ),
  ).toBe(Date.parse(proposedStart));
  const state = await fixture.employeeClient.rpc("get_employee_time_clock");
  expect(JSON.stringify(state.data)).toContain(
    adjustmentId === original.time_entry_id ? adjustmentId : original.time_entry_id,
  );
  const audit = await fixture.service
    .from("audit_events")
    .select("action,actor_user_id,before_data,after_data")
    .eq("organization_id", fixture.organizationId);
  expect(
    audit.data.filter(
      (event: { action: string }) => event.action === "time_entry.adjusted",
    ),
  ).toHaveLength(1);
  expect(
    audit.data.filter(
      (event: { action: string }) => event.action === "time_entry.missed_entry_added",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(audit.data)).not.toMatch(
    /Fictieve reden|Akkoord|Andere dag|manager_note|employee_reason/u,
  );
  await employeeContext.close();
});

test("concurrerende managertabbladen leveren één definitieve beslissing", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const fixture = await team();
  const requestId = await submit(fixture);
  await login(page, fixture.manager.email, "manager");
  await page.goto("/manager/corrections");
  const second = await context.newPage();
  await second.goto("/manager/corrections");
  await (
    await reveal(page, requestId)
  )
    .getByRole("button", { name: "Goedkeuren", exact: true })
    .click();
  await (
    await reveal(second, requestId)
  )
    .getByRole("button", { name: "Afwijzen", exact: true })
    .click();
  await second
    .getByLabel("Reden van afwijzing")
    .fill("Gelijktijdige synthetische afwijzing.");
  await Promise.all([
    page.getByRole("button", { name: "Goedkeuren en toepassen" }).click(),
    second.getByRole("button", { name: "Afwijzing bevestigen" }).click(),
  ]);
  await expect
    .poll(async () => {
      const result = await fixture.service
        .from("correction_requests")
        .select("status")
        .eq("id", requestId)
        .single();
      return result.data?.status;
    })
    .toMatch(/approved|rejected/u);
  await page.reload();
  await second.reload();
  const result = await fixture.service
    .from("correction_requests")
    .select("status")
    .eq("id", requestId)
    .single();
  for (const tab of [page, second])
    await expect(
      (await reveal(tab, requestId)).getByText(
        result.data.status === "approved" ? "Goedgekeurd" : "Afgewezen",
        { exact: true },
      ),
    ).toBeVisible();
  const audit = await fixture.service
    .from("audit_events")
    .select("action")
    .eq("entity_id", requestId)
    .in("action", ["correction_request.approved", "correction_request.rejected"]);
  expect(audit.data).toHaveLength(1);
  const facts = await fixture.service
    .from("time_entries")
    .select("id")
    .eq("membership_id", fixture.employee.membershipId);
  expect(facts.data).toHaveLength(result.data.status === "approved" ? 1 : 0);
});

test("RPC-retries en klok/correctie/beslissingsraces behouden precies één toepassing", async () => {
  test.setTimeout(120_000);
  const fixture = await team();
  const second = await session(fixture.manager.email);
  const id = await submit(fixture);
  const payload = decision(id);
  const replays = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? second : fixture.managerClient).rpc(
        "decide_correction_request",
        payload,
      ),
    ),
  );
  for (const result of replays) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual(replays[0].data);
  }
  expect(
    (
      await second.rpc("decide_correction_request", {
        ...payload,
        manager_note: "changed",
      })
    ).error?.message,
  ).toBe("decision_request_id_reused");
  const nextId = await submit(fixture, {
    proposed_start_local: "2010-02-02T09:00",
    proposed_end_local: "2010-02-02T10:00",
  });
  const rivals = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? second : fixture.managerClient).rpc(
        "decide_correction_request",
        decision(nextId, index % 2 ? "reject" : "approve", "synthetic decision"),
      ),
    ),
  );
  expect(rivals.every((result) => !result.error)).toBe(true);
  expect(rivals.filter((result) => result.data[0].did_decide)).toHaveLength(1);
  expect(
    rivals.filter((result) => result.data[0].result_code === "already_decided"),
  ).toHaveLength(7);
  const thirdId = await submit(fixture, {
    proposed_start_local: "2010-02-03T09:00",
    proposed_end_local: "2010-02-03T10:00",
  });
  const mixed = await Promise.all([
    fixture.managerClient.rpc("decide_correction_request", decision(thirdId)),
    fixture.employeeClient.rpc("clock_in", { request_id: randomUUID() }),
    fixture.employeeClient.rpc("withdraw_employee_correction_request", {
      request_id: randomUUID(),
      correction_request_id: thirdId,
    }),
    fixture.employeeClient.rpc("submit_employee_correction_request", {
      request_id: randomUUID(),
      request_kind: "missed_entry",
      target_time_entry_id: "",
      proposed_start_local: "2010-02-04T09:00",
      proposed_end_local: "2010-02-04T10:00",
      proposed_start_occurrence: "",
      proposed_end_occurrence: "",
      employee_reason: "Synthetic competing claim",
    }),
  ]);
  expect(mixed[0].error).toBeNull();
  expect(mixed[1].error).toBeNull();
  expect(mixed[3].error).toBeNull();
  expect(mixed[2].error?.message ?? "withdrawn").toMatch(
    /withdrawn|correction_not_pending/u,
  );
  expect(
    (await fixture.employeeClient.rpc("clock_out", { request_id: randomUUID() })).error,
  ).toBeNull();
  const audits = await fixture.service
    .from("audit_events")
    .select("action,entity_id,actor_user_id,before_data,after_data")
    .eq("organization_id", fixture.organizationId);
  expect(
    audits.data.filter(
      (event: { action: string; entity_id: string }) =>
        event.entity_id === id && event.action === "correction_request.approved",
    ),
  ).toHaveLength(1);
  expect(
    audits.data.filter(
      (event: { action: string; entity_id: string }) =>
        event.entity_id === nextId &&
        /correction_request\.(approved|rejected)/u.test(event.action),
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(audits.data)).not.toMatch(
    /manager_note|employee_reason|synthetic decision/u,
  );
  await second.auth.signOut();
});

test("verouderde aanvraag blijft open; generieke fout behoudt veilige retry", async ({
  page,
}) => {
  test.setTimeout(100_000);
  const fixture = await team();
  const original = await closedEntry(fixture);
  const id = await submit(fixture, {
    request_kind: "adjustment",
    target_time_entry_id: original.time_entry_id,
    proposed_start_local: wallTime(
      new Date(Date.parse(original.started_at) - 900_000).toISOString(),
    ),
    proposed_end_local: wallTime(original.ended_at),
  });
  ownerSql(
    `update public.time_entries set ended_at = ended_at + interval '1 second' where id = '${assertLocalUuid(original.time_entry_id)}';`,
  );
  await login(page, fixture.manager.email, "manager");
  await page.goto("/manager/corrections");
  await (
    await reveal(page, id)
  )
    .getByRole("button", { name: "Goedkeuren", exact: true })
    .click();
  await page.getByRole("button", { name: "Goedkeuren en toepassen" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "De oorspronkelijke registratie is intussen gewijzigd.",
  );
  await expect(page.getByRole("dialog").getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Annuleren" }).click();
  await (
    await reveal(page, id)
  )
    .getByRole("button", { name: "Afwijzen", exact: true })
    .click();
  await page
    .getByLabel("Reden van afwijzing")
    .fill("Maak een nieuw voorstel voor de gewijzigde registratie.");
  let failOnce = true;
  await page.route("**/manager/corrections", async (route) => {
    if (failOnce && route.request().method() === "POST") {
      failOnce = false;
      return route.abort("failed");
    }
    await route.fallback();
  });
  await page.getByRole("button", { name: "Afwijzing bevestigen" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "De beslissing kon niet worden verwerkt.",
  );
  await page.getByRole("button", { name: "Afwijzing bevestigen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Aanvraag afgewezen." }),
  ).toBeVisible();
  const audit = await fixture.service
    .from("audit_events")
    .select("action")
    .eq("organization_id", fixture.organizationId)
    .in("action", ["time_entry.adjusted", "correction_request.rejected"]);
  expect(audit.data).toEqual([{ action: "correction_request.rejected" }]);
});

test("managerqueue en beslissingen sluiten andere rollen en tenants uit", async ({
  page,
}) => {
  test.setTimeout(100_000);
  const fixture = await team();
  const other = await team();
  const ownId = await submit(fixture);
  const otherId = await submit(other);
  await login(page, fixture.employee.email, "employee");
  await page.goto("/manager/corrections");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/unauthorized");
  expect(
    (await fixture.employeeClient.rpc("decide_correction_request", decision(ownId)))
      .error?.code,
  ).toBe("42501");
  const queue = await fixture.managerClient.rpc("get_manager_correction_requests");
  expect(queue.error).toBeNull();
  expect(queue.data.requests.map((row: { id: string }) => row.id)).toEqual([ownId]);
  expect(JSON.stringify(queue.data)).not.toContain(otherId);
  expect(
    (await fixture.managerClient.rpc("decide_correction_request", decision(otherId)))
      .error?.code,
  ).toBe("42501");
  const direct = await fixture.managerClient
    .from("time_entries")
    .update({ started_at: "2010-01-01T10:00:00Z" })
    .eq("membership_id", fixture.employee.membershipId);
  expect(direct.error?.code).toBe("42501");
  const changed = await fixture.service
    .from("memberships")
    .update({ status: "inactive" })
    .eq("id", fixture.manager.membershipId);
  expect(changed.error).toBeNull();
  expect(
    (await fixture.managerClient.rpc("get_manager_correction_requests")).error?.code,
  ).toBe("42501");
  expect(
    (await fixture.managerClient.rpc("decide_correction_request", decision(ownId)))
      .error?.code,
  ).toBe("42501");
});

test("manager hercontroleert sessieverval na wachten op werknemersslot", async () => {
  test.setTimeout(90_000);
  const fixture = await team();
  const id = await submit(fixture);
  const holder = spawn(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cloxa2",
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const held = new Promise<void>((resolve, reject) => {
    holder.stdout.on("data", (data: Buffer) => {
      if (data.toString().includes("LOCK_HELD")) resolve();
    });
    holder.once("error", () => reject(new Error("Local lock fixture failed.")));
    holder.once("exit", (code) => {
      if (code !== 0) reject(new Error("Local lock fixture exited."));
    });
  });
  holder.stdin.write(
    `begin; select pg_advisory_xact_lock(17031, hashtext('${assertLocalUuid(fixture.employee.userId)}'));\n\\echo LOCK_HELD\n`,
  );
  await held;
  try {
    ownerSql(
      `update auth.sessions set not_after = clock_timestamp() + interval '2 seconds' where user_id = '${assertLocalUuid(fixture.manager.userId)}';`,
    );
    const waiting = fixture.managerClient
      .rpc("decide_correction_request", decision(id))
      .then((result: { error: { code: string } | null }) => result);
    await expect
      .poll(() =>
        Number(
          ownerSql(
            "select count(*) from pg_stat_activity where wait_event = 'advisory' and query like '%decide_correction_request%';",
          ),
        ),
      )
      .toBeGreaterThan(0);
    // The server's clock, rather than a browser timer, establishes the expired state.
    await expect
      .poll(() =>
        ownerSql(
          `select bool_and(not_after <= clock_timestamp()) from auth.sessions where user_id = '${assertLocalUuid(fixture.manager.userId)}';`,
        ),
      )
      .toBe("t");
    holder.stdin.end("commit;\n");
    expect((await waiting).error?.code).toBe("42501");
    const request = await fixture.service
      .from("correction_requests")
      .select("status")
      .eq("id", id)
      .single();
    expect(request.data.status).toBe("pending");
    const facts = await fixture.service
      .from("time_entries")
      .select("id")
      .eq("membership_id", fixture.employee.membershipId);
    expect(facts.data).toHaveLength(0);
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\n");
  }
});
