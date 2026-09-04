import { randomUUID } from "node:crypto";
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
  const email = requireFictionalEmail(`break.${role}.${randomUUID()}@example.test`);
  const user = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { cloxa_local_fixture: "live-break-v1" },
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
      employee_code: "SYNREVIEW1234567890123456789012345",
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
  return {
    manager,
    employee,
    organizationId: org.data.id,
    worksiteId: worksite.data.id,
    managerClient: await session(manager.email),
    employeeClient: await session(employee.email),
    service,
  };
}
async function login(page: Page, email: string, role: "manager" | "employee") {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/${role}`);
}

test.beforeEach(async ({ context }) => {
  await protect(context);
});

test("live pauze met twee tabs, toetsenbord en exacte 320px", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90_000);
  const fixture = await team();
  if (info.project.name === "chromium-mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await login(page, fixture.employee.email, "employee");
  await page.getByRole("button", { name: "Start werk", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start pauze", exact: true }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto("/employee");
  await Promise.all(
    [page, second].map((tab) =>
      tab.getByRole("button", { name: "Start pauze", exact: true }).click(),
    ),
  );
  for (const tab of [page, second]) {
    await tab.reload();
    await expect(tab.getByRole("heading", { name: "Je bent met pauze" })).toBeVisible();
    await expect(
      tab.getByTestId("today-entries").getByText("Je bent met pauze", { exact: true }),
    ).toBeVisible();
    await expect(
      tab.getByRole("button", { name: "Stop werk", exact: true }),
    ).toBeDisabled();
    await expect(
      tab.getByText("Beëindig eerst je pauze om het werk te stoppen."),
    ).toBeVisible();
  }
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `.impeccable/review/breaks-open-${info.project.name}.png`,
      fullPage: true,
    });
  }
  const facts = await fixture.employeeClient
    .from("time_breaks")
    .select("id,version,ended_at");
  expect(facts.error).toBeNull();
  expect(facts.data).toHaveLength(1);
  expect(facts.data[0].version).toBe(1);
  await page.getByRole("button", { name: "Beëindig pauze", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Pauze beëindigd.");
  await expect(page.getByRole("status")).toBeFocused();
  await page.getByRole("button", { name: "Stop werk", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Je bent niet aan het werk" }),
  ).toBeVisible();
  for (const label of [
    "Bruto",
    "Afgeronde pauzes",
    "Netto gewerkt",
    "Onbetaalde pauzes",
  ])
    await expect(
      page.getByTestId("break-summary").getByText(label, { exact: true }),
    ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `.impeccable/review/breaks-${info.project.name}.png`,
      fullPage: true,
    });
  }
  await page.goto("/employee/corrections");
  await page
    .getByTestId("closed-entries")
    .getByRole("button", { name: "Correctie aanvragen", exact: true })
    .click();
  await expect(
    page.getByTestId("correction-form").getByText("Onbetaalde pauzes", { exact: true }),
  ).toBeVisible();
});

test("duplicate retries and mixed clock/break races have one serial outcome", async () => {
  test.setTimeout(120_000);
  const fixture = await team();
  const second = await session(fixture.employee.email);
  const employee = fixture.employeeClient;
  expect(
    (await employee.rpc("clock_in", { request_id: randomUUID() })).error,
  ).toBeNull();
  const startId = randomUUID();
  const starts = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? employee : second).rpc("start_break", { request_id: startId }),
    ),
  );
  for (const result of starts) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual(starts[0].data);
  }
  expect(starts[0].data.result_code).toBe("started");
  const mixedEnd = await Promise.all([
    employee.rpc("end_break", { request_id: randomUUID() }),
    second.rpc("clock_out", { request_id: randomUUID() }),
  ]);
  for (const result of mixedEnd) expect(result.error).toBeNull();
  expect(mixedEnd[0].data.result_code).toBe("ended");
  expect(["open_break", "stopped"]).toContain(mixedEnd[1].data[0].result_code);
  expect(
    (await employee.rpc("clock_out", { request_id: randomUUID() })).error,
  ).toBeNull();
  expect(
    ownerSql(
      `select count(*) from private.time_break_operations where request_id='${assertLocalUuid(startId)}'`,
    ),
  ).toBe("1");
  expect(
    ownerSql(
      `select count(*) from public.audit_events where entity_id='${assertLocalUuid(starts[0].data.break_id)}' and action='time_break.started'`,
    ),
  ).toBe("1");

  for (let round = 0; round < 4; round++) {
    await employee.rpc("clock_in", { request_id: randomUUID() });
    const race = await Promise.all([
      employee.rpc("start_break", { request_id: randomUUID() }),
      second.rpc("clock_out", { request_id: randomUUID() }),
    ]);
    for (const result of race) expect(result.error).toBeNull();
    expect([
      ["started", "open_break"],
      ["no_open_shift", "stopped"],
    ]).toContainEqual([race[0].data.result_code, race[1].data[0].result_code]);
    if (race[0].data.result_code === "started") {
      const id = randomUUID();
      const ends = await Promise.all(
        Array.from({ length: 4 }, () => employee.rpc("end_break", { request_id: id })),
      );
      for (const result of ends) {
        expect(result.error).toBeNull();
        expect(result.data).toEqual(ends[0].data);
      }
      await employee.rpc("clock_out", { request_id: randomUUID() });
    }
  }
  expect(
    ownerSql(
      `select count(*) from public.time_breaks where employee_membership_id='${assertLocalUuid(fixture.employee.membershipId)}' and ended_at is null`,
    ),
  ).toBe("0");
  await second.auth.signOut();
});

test("authorization expiry while waiting denies break without outcome", async () => {
  test.setTimeout(90_000);
  const fixture = await team();
  await fixture.employeeClient.rpc("clock_in", { request_id: randomUUID() });
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
    holder.once("error", () => reject(new Error("Local break lock fixture failed.")));
  });
  holder.stdin.write(
    `begin; select pg_advisory_xact_lock(17031,hashtext('${assertLocalUuid(fixture.employee.userId)}'));\n\\echo LOCK_HELD\n`,
  );
  await held;
  const id = randomUUID();
  try {
    ownerSql(
      `update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where user_id='${assertLocalUuid(fixture.employee.userId)}'`,
    );
    const waiting = fixture.employeeClient
      .rpc("start_break", { request_id: id })
      .then((result: { error: { code: string } | null }) => result);
    await expect
      .poll(() =>
        Number(
          ownerSql(
            "select count(*) from pg_stat_activity where wait_event='advisory' and query like '%start_break%'",
          ),
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        ownerSql(
          `select bool_and(not_after<=clock_timestamp()) from auth.sessions where user_id='${assertLocalUuid(fixture.employee.userId)}'`,
        ),
      )
      .toBe("t");
    holder.stdin.end("commit;\n");
    expect((await waiting).error?.code).toBe("42501");
    expect(
      ownerSql(
        `select count(*) from private.time_break_operations where request_id='${assertLocalUuid(id)}'`,
      ),
    ).toBe("0");
    expect(
      ownerSql(
        `select count(*) from public.time_breaks where employee_membership_id='${assertLocalUuid(fixture.employee.membershipId)}'`,
      ),
    ).toBe("0");
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\n");
  }
});

test("manager approval and a new live break serialize without rewriting prior breaks", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const fixture = await team();
  const employee = fixture.employeeClient;
  const opened = await employee.rpc("clock_in", { request_id: randomUUID() });
  const entryId = assertLocalUuid(opened.data[0].time_entry_id);
  await employee.rpc("start_break", { request_id: randomUUID() });
  await employee.rpc("end_break", { request_id: randomUUID() });
  await employee.rpc("clock_out", { request_id: randomUUID() });
  const before = await employee
    .from("time_breaks")
    .select("*")
    .eq("time_entry_id", entryId);
  expect(before.error).toBeNull();
  const proposedStart = ownerSql(
    `select to_char((started_at - interval '1 second') at time zone 'Europe/Brussels','YYYY-MM-DD"T"HH24:MI:SS.US') from public.time_entries where id='${entryId}'`,
  );
  const proposedEnd = ownerSql(
    `select to_char(ended_at at time zone 'Europe/Brussels','YYYY-MM-DD"T"HH24:MI:SS.US') from public.time_entries where id='${entryId}'`,
  );
  const submitted = await employee.rpc("submit_employee_correction_request", {
    request_id: randomUUID(),
    request_kind: "adjustment",
    target_time_entry_id: entryId,
    proposed_start_local: proposedStart,
    proposed_start_occurrence: "",
    proposed_end_local: proposedEnd,
    proposed_end_occurrence: "",
    employee_reason: "Fictieve aanpassing met behouden pauze",
  });
  expect(submitted.error).toBeNull();
  expect(submitted.data[0].result_code).toBe("submitted");
  if (info.project.name === "chromium-mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await login(page, fixture.manager.email, "manager");
  await page.goto("/manager/corrections");
  const review = page.getByTestId(`review-${submitted.data[0].correction_request_id}`);
  await review.locator("summary").click();
  await expect(review.getByText("Onbetaalde pauzes", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `.impeccable/review/breaks-manager-${info.project.name}.png`,
      fullPage: true,
    });
  }

  await employee.rpc("clock_in", { request_id: randomUUID() });
  const mixed = await Promise.all([
    fixture.managerClient.rpc("decide_correction_request", {
      request_id: randomUUID(),
      correction_request_id: submitted.data[0].correction_request_id,
      decision: "approve",
      manager_note: "",
    }),
    employee.rpc("start_break", { request_id: randomUUID() }),
  ]);
  for (const result of mixed) expect(result.error).toBeNull();
  expect(mixed[0].data[0].result_code).toBe("approved");
  expect(mixed[1].data.result_code).toBe("started");
  const after = await employee
    .from("time_breaks")
    .select("*")
    .eq("time_entry_id", entryId);
  expect(after.data).toEqual(before.data);
  await employee.rpc("end_break", { request_id: randomUUID() });
  await employee.rpc("clock_out", { request_id: randomUUID() });
});

test("v1 blocks new break facts while original CSV/JSON bytes and hashes stay fixed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await team();
  const employee = fixture.employeeClient;
  await employee.rpc("clock_in", { request_id: randomUUID() });
  await employee.rpc("clock_out", { request_id: randomUUID() });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const period = { period_start_local: date, period_end_local: date };
  const old = await fixture.managerClient.rpc("create_time_export", {
    ...period,
    request_id: randomUUID(),
    confirmed: true,
  });
  expect(old.error).toBeNull();
  expect(old.data[0].result_code).toBe("created");
  const exportId = old.data[0].export_id;
  await login(page, fixture.manager.email, "manager");
  const previous = [];
  for (const format of ["csv", "json"]) {
    const response = await page.request.get(`/manager/exports/${exportId}/${format}`);
    expect(response.ok()).toBe(true);
    previous.push({
      format,
      bytes: await response.body(),
      hash: response.headers()["x-cloxa-artifact-sha256"],
    });
  }
  await employee.rpc("clock_in", { request_id: randomUUID() });
  await employee.rpc("start_break", { request_id: randomUUID() });
  await employee.rpc("end_break", { request_id: randomUUID() });
  await employee.rpc("clock_out", { request_id: randomUUID() });
  const preview = await fixture.managerClient.rpc("preview_time_export", period);
  expect(preview.error).toBeNull();
  expect(preview.data.blockers).toContain("break_data_requires_v2");
  const payload = { ...period, request_id: randomUUID(), confirmed: true };
  const blocked = await fixture.managerClient.rpc("create_time_export", payload);
  const retried = await fixture.managerClient.rpc("create_time_export", payload);
  expect(blocked.error).toBeNull();
  expect(retried.data).toEqual(blocked.data);
  expect(blocked.data[0]).toEqual({
    result_code: "break_data_requires_v2",
    did_create: false,
    export_id: null,
    manifest: null,
  });
  expect(
    ownerSql(
      `select count(*) from public.time_exports where organization_id='${assertLocalUuid(fixture.organizationId)}'`,
    ),
  ).toBe("1");
  expect(
    ownerSql(
      `select count(*) from public.audit_events where organization_id='${assertLocalUuid(fixture.organizationId)}' and action='time_export.created'`,
    ),
  ).toBe("1");
  for (const item of previous) {
    const response = await page.request.get(
      `/manager/exports/${exportId}/${item.format}`,
    );
    expect(await response.body()).toEqual(item.bytes);
    expect(response.headers()["x-cloxa-artifact-sha256"]).toBe(item.hash);
  }
});
