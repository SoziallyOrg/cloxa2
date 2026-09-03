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

async function account(
  organizationId: string,
  role: "manager" | "employee",
  displayName: string,
  employeeCode: string | null,
) {
  const service = admin();
  const email = requireFictionalEmail(`export.${role}.${randomUUID()}@example.test`);
  const user = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { cloxa_local_fixture: "manager-export-v1" },
  });
  if (user.error || !user.data.user?.id)
    throw new Error("Synthetic export account failed.");
  const userId = user.data.user.id;
  const membership = await service
    .from("memberships")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
      employee_code: employeeCode,
    })
    .select("id")
    .single();
  const profile = await service
    .from("profiles")
    .insert({ user_id: userId, display_name: displayName });
  if (membership.error || profile.error)
    throw new Error("Synthetic export membership failed.");
  return { email, userId, membershipId: membership.data.id };
}

async function authenticated(email: string) {
  const client = createClient(
    supabaseOrigin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw new Error("Synthetic export login failed.");
  return client;
}

async function exportTeam() {
  const service = admin();
  const organization = await service
    .from("organizations")
    .insert({ name: "Fictieve exportorganisatie", lifecycle_status: "research_pilot" })
    .select("id")
    .single();
  if (organization.error) throw new Error("Synthetic export organization failed.");
  const worksite = await service
    .from("worksites")
    .insert({
      organization_id: organization.data.id,
      name: ' =Werkplek; "Noord"\r\nregel',
      timezone: "Europe/Brussels",
    })
    .select("id")
    .single();
  if (worksite.error) throw new Error("Synthetic export worksite failed.");
  const manager = await account(
    organization.data.id,
    "manager",
    "Fictieve exportmanager",
    null,
  );
  const employee = await account(
    organization.data.id,
    "employee",
    ' =SOM(1); "Élodie"\r\nregel',
    '+SYN,"1";\tcode',
  );
  return {
    service,
    organizationId: organization.data.id as string,
    worksiteId: worksite.data.id as string,
    manager,
    employee,
    managerClient: await authenticated(manager.email),
    employeeClient: await authenticated(employee.email),
  };
}

async function login(page: Page, email: string, role: "manager" | "employee") {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/${role}`);
}

function brusselsDate(value = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function wallTime(value: Date) {
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
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

async function closedEntry(fixture: Awaited<ReturnType<typeof exportTeam>>) {
  const start = await fixture.employeeClient.rpc("clock_in", {
    request_id: randomUUID(),
  });
  const stop = await fixture.employeeClient.rpc("clock_out", {
    request_id: randomUUID(),
  });
  if (start.error || stop.error)
    throw new Error("Synthetic export clock entry failed.");
  return stop.data[0];
}

async function pendingAdjustment(
  fixture: Awaited<ReturnType<typeof exportTeam>>,
  entry: { time_entry_id: string; started_at: string; ended_at: string },
) {
  const start = new Date(new Date(entry.started_at).getTime() - 60_000);
  const result = await fixture.employeeClient.rpc(
    "submit_employee_correction_request",
    {
      request_id: randomUUID(),
      request_kind: "adjustment",
      target_time_entry_id: entry.time_entry_id,
      proposed_start_local: wallTime(start),
      proposed_start_occurrence: "",
      proposed_end_local: wallTime(new Date(entry.ended_at)),
      proposed_end_occurrence: "",
      employee_reason: "Fictieve gelijktijdige correctie",
    },
  );
  if (result.error)
    throw new Error(`Synthetic adjustment failed: ${result.error.code}`);
  return result.data[0].correction_request_id as string;
}

async function pendingMissedEntry(fixture: Awaited<ReturnType<typeof exportTeam>>) {
  const end = new Date(Date.now() - 60 * 60 * 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const result = await fixture.employeeClient.rpc(
    "submit_employee_correction_request",
    {
      request_id: randomUUID(),
      request_kind: "missed_entry",
      target_time_entry_id: "",
      proposed_start_local: wallTime(start),
      proposed_start_occurrence: "",
      proposed_end_local: wallTime(end),
      proposed_end_occurrence: "",
      employee_reason: "Fictieve exportblokkering",
    },
  );
  if (result.error)
    throw new Error(`Synthetic export blocker failed: ${result.error.code}`);
}

function parseCsv(text: string) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && source[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else field += char;
  }
  return rows;
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

test("manager bevestigt, vergelijkt en downloadt één vaste CSV/JSON-momentopname", async ({
  browser,
  page,
}, testInfo) => {
  if (testInfo.project.name === "chromium-mobile")
    await page.setViewportSize({ width: 320, height: 760 });
  const fixture = await exportTeam();
  await closedEntry(fixture);
  await login(page, fixture.manager.email, "manager");
  await expect(page.getByRole("link", { name: "Exports openen" })).toBeVisible();
  await page.getByRole("link", { name: "Exports openen" }).click();

  const today = brusselsDate();
  await page.getByLabel("Startdatum (inclusief)").fill(today);
  await page.getByLabel("Einddatum (inclusief)").fill(today);
  await page.getByRole("button", { name: "Voorbeeld controleren" }).click();
  await expect(
    page.getByRole("heading", { name: "Feiten op dit moment" }),
  ).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await page
    .getByText("Bekijk feitelijke registraties en versies", { exact: true })
    .click();
  await expect(
    page.getByText("Bronregistratie / versie", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `.impeccable/review/${testInfo.project.name === "chromium-mobile" ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
  }
  const confirm = page.getByRole("button", { name: "Deze momentopname bevestigen" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await noOverflow(page);
  if (process.env.CLOXA_CAPTURE_REVIEW === "1")
    await page.screenshot({
      path: `.impeccable/review/export-dialog-${testInfo.project.name === "chromium-mobile" ? "mobile" : "desktop"}.png`,
    });
  await page.keyboard.press("Escape");
  await expect(confirm).toBeFocused();
  await confirm.click();
  // Commit once, drop only the response, then retry unchanged confirmation in UI.
  await page.route("**/manager/exports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "Momentopname maken" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await page.unroute("**/manager/exports");
  await dialog.getByRole("button", { name: "Momentopname maken" }).click();
  await expect(page.getByTestId("created-export")).toBeVisible();

  const csvHref = await page
    .getByRole("link", { name: "CSV downloaden" })
    .first()
    .getAttribute("href");
  const jsonHref = await page
    .getByRole("link", { name: "JSON downloaden" })
    .first()
    .getAttribute("href");
  expect(csvHref).toBeTruthy();
  expect(jsonHref).toBeTruthy();
  // Browser-managed transient downloads are read as streams, never saveAs'ed or logged.
  for (const label of ["CSV downloaden", "JSON downloaden"]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: label }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^cloxa-time-export_[A-Za-z0-9_.-]+$/u,
    );
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const response = await page.request.get(
      label === "CSV downloaden" ? csvHref! : jsonHref!,
    );
    expect(Buffer.concat(chunks).equals(await response.body())).toBe(true);
    await download.delete();
  }
  const csvResponse = await page.request.get(csvHref!);
  const jsonResponse = await page.request.get(jsonHref!);
  expect(csvResponse.status()).toBe(200);
  expect(jsonResponse.status()).toBe(200);
  expect(csvResponse.headers()["cache-control"]).toContain("private");
  expect(csvResponse.headers()["cache-control"]).toContain("no-store");
  expect(jsonResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(csvResponse.headers()["content-disposition"]).toMatch(
    /^attachment; filename="cloxa-time-export_[A-Za-z0-9_.-]+"$/u,
  );
  const csvRows = parseCsv((await csvResponse.body()).toString("utf8"));
  const json = JSON.parse((await jsonResponse.body()).toString("utf8"));
  const header = csvRows[0]!;
  const row = csvRows[1]!;
  const cell = (name: string) => row[header.indexOf(name)];
  expect(cell("dataset_sha256")).toBe(json.manifest.dataset_sha256);
  expect(cell("export_id")).toBe(json.manifest.export_id);
  expect(cell("duration_microseconds")).toBe(json.records[0].duration_microseconds);
  expect(cell("employee_code")).toBe(`'+SYN,"1";\tcode`);
  expect(cell("employee_display_name")).toBe(`' =SOM(1); "Élodie"\r\nregel`);
  expect(cell("worksite_name")).toBe(`' =Werkplek; "Noord"\r\nregel`);
  expect(json.records[0].employee_code).toBe(`+SYN,"1";\tcode`);
  expect(json.records[0].employee_display_name).toBe(` =SOM(1); "Élodie"\r\nregel`);

  const firstExportId = json.manifest.export_id as string;
  const retryId = randomUUID();
  const [retryOne, retryTwo] = await Promise.all([
    fixture.managerClient.rpc("create_time_export", {
      request_id: retryId,
      period_start_local: today,
      period_end_local: today,
      confirmed: true,
    }),
    fixture.managerClient.rpc("create_time_export", {
      request_id: retryId,
      period_start_local: today,
      period_end_local: today,
      confirmed: true,
    }),
  ]);
  expect(retryOne.error).toBeNull();
  expect(retryTwo.error).toBeNull();
  expect(retryOne.data[0].export_id).toBe(retryTwo.data[0].export_id);
  expect(retryOne.data[0].export_id).not.toBe(firstExportId);
  const audit = await fixture.service
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.organizationId)
    .eq("action", "time_export.created");
  expect(audit.count).toBe(2);

  await page.reload();
  await expect(page.getByTestId("export-history").locator("li")).toHaveCount(2);
  await expect(
    page.getByText(json.manifest.dataset_sha256, { exact: true }),
  ).toBeVisible();

  const employeeContext = await browser.newContext();
  await protect(employeeContext);
  const employeePage = await employeeContext.newPage();
  await login(employeePage, fixture.employee.email, "employee");
  expect((await employeeContext.request.get(`${appOrigin}${jsonHref}`)).status()).toBe(
    404,
  );
  await employeeContext.close();

  const other = await exportTeam();
  const otherContext = await browser.newContext();
  await protect(otherContext);
  const otherPage = await otherContext.newPage();
  await login(otherPage, other.manager.email, "manager");
  expect((await otherContext.request.get(`${appOrigin}${jsonHref}`)).status()).toBe(
    404,
  );
  await otherContext.close();

  assertLocalUuid(fixture.manager.userId);
  ownerSql(
    `update auth.sessions set not_after = clock_timestamp() - interval '1 second' where user_id = '${fixture.manager.userId}'::uuid;`,
  );
  expect((await page.request.get(jsonHref!)).status()).toBe(404);
  ownerSql(
    `update auth.sessions set not_after = null where user_id = '${fixture.manager.userId}'::uuid;`,
  );
  expect((await page.request.get(jsonHref!)).status()).toBe(200);
  ownerSql(
    `delete from auth.sessions where user_id = '${fixture.manager.userId}'::uuid;`,
  );
  expect((await page.request.get(jsonHref!)).status()).toBe(404);
});

test("exact 320px behoudt dialoogfocus, foutmelding en correctienavigatie", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  await page.setViewportSize({ width: 320, height: 760 });
  const fixture = await exportTeam();
  await closedEntry(fixture);
  await login(page, fixture.manager.email, "manager");
  await page.goto("/manager/exports");
  const today = brusselsDate();
  await page.getByLabel("Startdatum (inclusief)").fill(today);
  await page.getByLabel("Einddatum (inclusief)").fill(today);
  await page.getByRole("button", { name: "Voorbeeld controleren" }).click();
  const confirm = page.getByRole("button", { name: "Deze momentopname bevestigen" });
  await confirm.click();
  await pendingMissedEntry(fixture);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Momentopname maken" })
    .click();
  const error = page.getByRole("dialog").getByRole("alert");
  await expect(error).toContainText("correctie in afwachting");
  await expect(error).toBeFocused();
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeFocused();
  await page.getByRole("button", { name: "Voorbeeld controleren" }).click();
  await expect(page.getByTestId("export-blockers")).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: "Open correcties" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/manager/corrections");
});

test("export-races met correctiebesluit en klokstop leveren alleen volledige uitkomsten", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const correctionFixture = await exportTeam();
  const entry = await closedEntry(correctionFixture);
  const correctionId = await pendingAdjustment(correctionFixture, entry);
  const today = brusselsDate();
  const [exportResult, decisionResult] = await Promise.all([
    correctionFixture.managerClient.rpc("create_time_export", {
      request_id: randomUUID(),
      period_start_local: today,
      period_end_local: today,
      confirmed: true,
    }),
    correctionFixture.managerClient.rpc("decide_correction_request", {
      request_id: randomUUID(),
      correction_request_id: correctionId,
      decision: "approve",
      manager_note: "",
    }),
  ]);
  expect(exportResult.error).toBeNull();
  expect(decisionResult.error).toBeNull();
  expect(decisionResult.data[0].result_code).toBe("approved");
  expect(["created", "pending_correction"]).toContain(exportResult.data[0].result_code);
  if (exportResult.data[0].result_code === "created") {
    const snapshot = await correctionFixture.managerClient.rpc(
      "get_time_export_snapshot",
      { export_id: exportResult.data[0].export_id },
    );
    expect(snapshot.error).toBeNull();
    expect(snapshot.data.records).toHaveLength(1);
    expect(snapshot.data.records[0].source_time_entry_id).toBe(entry.time_entry_id);
    expect(snapshot.data.records[0].source_time_entry_version).toBe(3);
  }

  const clockFixture = await exportTeam();
  const started = await clockFixture.employeeClient.rpc("clock_in", {
    request_id: randomUUID(),
  });
  expect(started.error).toBeNull();
  const [clockExport, stopped] = await Promise.all([
    clockFixture.managerClient.rpc("create_time_export", {
      request_id: randomUUID(),
      period_start_local: today,
      period_end_local: today,
      confirmed: true,
    }),
    clockFixture.employeeClient.rpc("clock_out", { request_id: randomUUID() }),
  ]);
  expect(clockExport.error).toBeNull();
  expect(stopped.error).toBeNull();
  expect(["created", "open_entry"]).toContain(clockExport.data[0].result_code);
  if (clockExport.data[0].result_code === "created") {
    const snapshot = await clockFixture.managerClient.rpc("get_time_export_snapshot", {
      export_id: clockExport.data[0].export_id,
    });
    expect(snapshot.error).toBeNull();
    expect(snapshot.data.records).toHaveLength(1);
    expect(snapshot.data.records[0].source_time_entry_id).toBe(
      stopped.data[0].time_entry_id,
    );
    expect(snapshot.data.records[0].source_time_entry_version).toBe(2);
  }
});

test("export hercontroleert managersessie na wachten op werknemersslot", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  test.setTimeout(90_000);
  const fixture = await exportTeam();
  await closedEntry(fixture);
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
    holder.once("error", () => reject(new Error("Local export lock fixture failed.")));
    holder.once("exit", (code) => {
      if (code !== 0) reject(new Error("Local export lock fixture exited."));
    });
  });
  holder.stdin.write(
    `begin; select pg_advisory_xact_lock(17031, hashtext('${assertLocalUuid(fixture.employee.userId)}'));\n\\echo LOCK_HELD\n`,
  );
  await held;
  const operationId = randomUUID();
  try {
    ownerSql(
      `update auth.sessions set not_after = clock_timestamp() + interval '2 seconds' where user_id = '${assertLocalUuid(fixture.manager.userId)}';`,
    );
    const waiting = fixture.managerClient
      .rpc("create_time_export", {
        request_id: operationId,
        period_start_local: brusselsDate(),
        period_end_local: brusselsDate(),
        confirmed: true,
      })
      .then((result: { error: { code: string } | null }) => result);
    await expect
      .poll(() =>
        Number(
          ownerSql(
            "select count(*) from pg_stat_activity where wait_event = 'advisory' and query like '%create_time_export%';",
          ),
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        ownerSql(
          `select bool_and(not_after <= clock_timestamp()) from auth.sessions where user_id = '${assertLocalUuid(fixture.manager.userId)}';`,
        ),
      )
      .toBe("t");
    holder.stdin.end("commit;\n");
    expect((await waiting).error?.code).toBe("42501");
    expect(
      Number(
        ownerSql(
          `select count(*) from public.time_exports where organization_id = '${assertLocalUuid(fixture.organizationId)}';`,
        ),
      ),
    ).toBe(0);
    expect(
      Number(
        ownerSql(
          `select count(*) from private.time_export_creation_operations where request_id = '${operationId}'::uuid;`,
        ),
      ),
    ).toBe(0);
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\n");
  }
});
