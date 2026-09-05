import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import {
  team,
  session,
  seedShift,
  cleanup,
  login,
  protect,
  ownerSql,
  assertLocalUuid,
} from "./phase8-fixtures.mts";

type Fixture = Awaited<ReturnType<typeof team>>;
const profileArgs = (f: Fixture) => ({
  request_id: randomUUID(),
  target_membership_id: f.employee.membershipId,
  display_name: "Fictieve nieuwe naam",
  employee_code: "NEW-09",
});
const statusArgs = (f: Fixture, action = "suspend") => ({
  request_id: randomUUID(),
  target_membership_id: f.employee.membershipId,
  action,
  confirmed: true,
});
const exportArgs = () => ({
  request_id: randomUUID(),
  period_start_local: "2010-01-01",
  period_end_local: "2010-01-01",
  confirmed: true,
});
async function cleanupTeam(f: Fixture) {
  const tenant = assertLocalUuid(f.organizationId);
  ownerSql(`begin; set local session_replication_role='replica';
    delete from private.manager_team_operations where organization_id='${tenant}';
    delete from public.invitations where organization_id='${tenant}'; commit;`);
  await cleanup(f);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
}
function invitations(f: Fixture) {
  const org = assertLocalUuid(f.organizationId);
  const actor = assertLocalUuid(f.manager.userId);
  const employee = assertLocalUuid(f.employee.userId);
  ownerSql(`insert into public.invitations(organization_id,normalized_email,invited_by,created_at,expires_at,status,accepted_by,accepted_at,revoked_at) values
    ('${org}','pending.phase9@example.test','${actor}',now()-interval '1 day',now()+interval '1 day','pending',null,null,null),
    ('${org}','accepted.phase9@example.test','${actor}',now()-interval '1 day',now()+interval '1 day','accepted','${employee}',now()-interval '1 hour',null),
    ('${org}','expired.phase9@example.test','${actor}',now()-interval '2 days',now()-interval '1 day','pending',null,null,null),
    ('${org}','revoked.phase9@example.test','${actor}',now()-interval '1 day',now()+interval '1 day','revoked',null,null,now()-interval '1 hour');`);
}

test("manager roster, edits, access, settings and invitation states at desktop and 320px", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const f = await team();
  const entry = await seedShift(f);
  invitations(f);
  const size = info.project.name.includes("mobile")
    ? { width: 320, height: 740 }
    : { width: 1280, height: 900 };
  await page.setViewportSize(size);
  await protect(page.context());
  const employeeContext = await browser.newContext({ viewport: size });
  await protect(employeeContext);
  const employeePage = await employeeContext.newPage();
  let leakedUrl = false;
  let leakedLog = false;
  for (const current of [page, employeePage]) {
    current.on("request", (request) => {
      const url = new URL(request.url());
      if (
        /@|%40|access_token=|refresh_token=|password=|token_hash=/iu.test(
          url.search + url.hash,
        )
      )
        leakedUrl = true;
    });
    current.on("console", (message) => {
      if (
        /example\.test|sb_secret_|eyJ[a-zA-Z0-9_-]{20}|access_token|refresh_token/iu.test(
          message.text(),
        )
      )
        leakedLog = true;
    });
  }
  try {
    await login(page, f.manager.email, "manager");
    await page.getByRole("link", { name: "Team en pilotinstellingen" }).click();
    await expect(
      page.getByRole("heading", { name: "Medewerkers", exact: true }),
    ).toBeVisible();
    const row = page.getByRole("article");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(f.employee.email);
    for (const label of ["In afwachting", "Aanvaard", "Verlopen", "Ingetrokken"])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    await noOverflow(page);
    await login(employeePage, f.employee.email, "employee");
    const oldExport = await f.managerClient.rpc("create_time_export", exportArgs());
    expect(oldExport.error).toBeNull();
    const oldId = oldExport.data[0].export_id;
    const beforeJson = await (
      await page.request.get(`/manager/exports/${oldId}/json`)
    ).body();
    const beforeCsv = await (
      await page.request.get(`/manager/exports/${oldId}/csv`)
    ).body();
    await row.getByRole("button", { name: "Gegevens wijzigen" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      row.getByRole("heading", { name: "Medewerkergegevens" }),
    ).toBeFocused();
    const hostileName = '<script>alert("fictief")</script>';
    const hostileCode = "<b>CODE-09</b>";
    await row.getByLabel("Weergavenaam", { exact: true }).fill(hostileName);
    await row
      .getByLabel("Personeelscode (optioneel)", { exact: true })
      .fill(hostileCode);
    await row.getByRole("button", { name: "Gegevens opslaan" }).click();
    await expect(row.getByRole("status")).toHaveText("Wijzigingen opgeslagen.");
    await expect(row.getByRole("status")).toBeFocused();
    await expect(
      row.getByRole("heading", { name: hostileName, exact: true }),
    ).toBeVisible();
    expect(await row.locator("script,b").count()).toBe(0);
    await row.getByRole("button", { name: "Sluiten", exact: true }).click();
    await expect(row.getByRole("button", { name: "Gegevens wijzigen" })).toBeFocused();

    await row.getByRole("button", { name: "Toegang schorsen" }).click();
    await expect(
      row.getByRole("heading", { name: "Schorsing bevestigen" }),
    ).toBeFocused();
    await expect(row).toContainText(
      "historische registraties, aanvragen en exports blijven bewaard",
    );
    await expect(row).toContainText(
      "Nog te beoordelen: 0 tijdcorrecties en 0 pauzecorrecties",
    );
    await row.getByRole("checkbox").check();
    await row
      .getByRole("button", { name: "Schorsing bevestigen", exact: true })
      .click();
    await expect(row.getByRole("status")).toHaveText(
      "Toegang geschorst. Historische gegevens blijven bewaard.",
    );
    await expect(row.getByRole("status")).toBeFocused();
    await employeePage.goto("/employee");
    await expect.poll(() => new URL(employeePage.url()).pathname).toBe("/unauthorized");
    const denied = await f.employeeClient.rpc("clock_in", { request_id: randomUUID() });
    expect(denied.error?.code).toBe("42501");
    await row.getByRole("button", { name: "Toegang herstellen" }).click();
    await row.getByRole("checkbox").check();
    await row
      .getByRole("button", { name: "Heractivering bevestigen", exact: true })
      .click();
    await expect(row.getByRole("status")).toHaveText(
      "Toegang hersteld voor hetzelfde lidmaatschap.",
    );
    await employeePage.goto("/employee");
    await expect.poll(() => new URL(employeePage.url()).pathname).toBe("/employee");
    const memberships = await f.service
      .from("memberships")
      .select("id,role,organization_id")
      .eq("user_id", f.employee.userId);
    expect(memberships.data).toEqual([
      {
        id: f.employee.membershipId,
        role: "employee",
        organization_id: f.organizationId,
      },
    ]);
    await row.getByRole("button", { name: "Annuleren" }).click();

    await page
      .getByLabel("Organisatienaam", { exact: true })
      .fill("Fictieve pilot Noord");
    await page
      .getByLabel("Naam van de werkplek", { exact: true })
      .fill("Fictieve werkplek Noord");
    await page.getByRole("button", { name: "Instellingen opslaan" }).click();
    await expect(
      page.getByRole("region", { name: "Pilotinstellingen" }).getByRole("status"),
    ).toHaveText("Wijzigingen opgeslagen.");
    await expect(
      page.getByRole("region", { name: "Pilotinstellingen" }).getByRole("status"),
    ).toBeFocused();
    await expect(page.getByText(/Tijdzone: Europe\/Brussels/u)).toBeVisible();
    const future = await f.managerClient.rpc("create_time_export", exportArgs());
    expect(future.error).toBeNull();
    const futureJson = await (
      await page.request.get(`/manager/exports/${future.data[0].export_id}/json`)
    ).json();
    expect(futureJson.records[0]).toMatchObject({
      employee_display_name: hostileName,
      employee_code: hostileCode,
      worksite_name: "Fictieve werkplek Noord",
    });
    expect(
      await (await page.request.get(`/manager/exports/${oldId}/json`)).body(),
    ).toEqual(beforeJson);
    expect(
      await (await page.request.get(`/manager/exports/${oldId}/csv`)).body(),
    ).toEqual(beforeCsv);

    // A stale tab still submits to authoritative server blocker checks.
    await row.getByRole("button", { name: "Toegang schorsen" }).click();
    await expect(
      row.getByRole("button", { name: "Schorsing bevestigen", exact: true }),
    ).toBeEnabled();
    expect(
      (await f.employeeClient.rpc("clock_in", { request_id: randomUUID() })).error,
    ).toBeNull();
    await row.getByRole("checkbox").check();
    await row
      .getByRole("button", { name: "Schorsing bevestigen", exact: true })
      .click();
    await expect(row.getByRole("alert")).toHaveText(
      "Schorsen kan niet: deze medewerker heeft een open dienst.",
    );
    await expect(row.getByRole("alert")).toBeFocused();
    await expect(
      row.getByRole("button", { name: "Schorsing bevestigen", exact: true }),
    ).toBeDisabled();
    const timeClaim = await f.employeeClient.rpc("submit_employee_correction_request", {
      request_id: randomUUID(),
      request_kind: "adjustment",
      target_time_entry_id: entry,
      proposed_start_local: "2010-01-01T09:01",
      proposed_start_occurrence: "",
      proposed_end_local: "2010-01-01T17:00:00.000001",
      proposed_end_occurrence: "",
      employee_reason: "Fictieve tijdcontrole",
    });
    expect(timeClaim.error).toBeNull();
    const breakEntry = randomUUID();
    ownerSql(`insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,ended_at,created_at)
      values('${breakEntry}','${assertLocalUuid(f.organizationId)}','${assertLocalUuid(f.employee.membershipId)}','${assertLocalUuid(f.worksiteId)}','2010-01-02 08:00Z','2010-01-02 16:00Z','2010-01-02 08:00Z')`);
    const breakClaim = await f.employeeClient.rpc("change_break_correction", {
      request_id: randomUUID(),
      intent: "missed_break",
      entry_id: breakEntry,
      target_id: null,
      expected_parent_version: 1,
      expected_break_version: null,
      start_local: "2010-01-02T13:00",
      end_local: "2010-01-02T13:15",
      start_occurrence: "",
      end_occurrence: "",
      reason: "Fictieve pauzecontrole",
    });
    expect(breakClaim.error).toBeNull();
    expect(breakClaim.data.result_code).toBe("submitted");
    await page.reload();
    await row.getByRole("button", { name: "Toegang schorsen" }).click();
    await expect(row).toContainText("Open dienst. Schorsen is geblokkeerd.");
    await expect(row).toContainText(
      "Nog te beoordelen: 1 tijdcorrecties en 1 pauzecorrecties",
    );
    await expect(
      row.getByRole("button", { name: "Schorsing bevestigen", exact: true }),
    ).toBeDisabled();
    await noOverflow(page);
    if (process.env.CLOXA_CAPTURE_REVIEW === "1") {
      await mkdir(".impeccable/review", { recursive: true });
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `.impeccable/review/${size.width === 320 ? "mobile" : "desktop"}.png`,
        fullPage: true,
        animations: "disabled",
        scale: "css",
      });
    }
    expect(leakedUrl).toBe(false);
    expect(leakedLog).toBe(false);
  } finally {
    await employeeContext.close();
    await cleanupTeam(f);
  }
});

test("duplicate profile calls, global UUID replay and simultaneous administration tabs", async () => {
  const f = await team();
  const manager2 = await session(f.manager.email);
  try {
    const args = profileArgs(f);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? manager2 : f.managerClient).rpc("update_employee_profile", args),
      ),
    );
    expect(results.every((r) => r.error === null)).toBe(true);
    for (const result of results) expect(result.data).toEqual(results[0].data);
    const org = assertLocalUuid(f.organizationId);
    expect(
      ownerSql(
        `select count(*) from public.audit_events where organization_id='${org}' and action='employee_profile.updated'`,
      ),
    ).toBe("1");
    expect(
      ownerSql(
        `select count(*) from private.manager_team_operations where organization_id='${org}'`,
      ),
    ).toBe("1");
    const reuse = await manager2.rpc("change_employee_membership_status", {
      ...statusArgs(f),
      request_id: args.request_id,
    });
    expect(reuse.error?.code).toBe("22023");
    const raceId = randomUUID();
    const globalRace = await Promise.all([
      f.managerClient.rpc("update_employee_profile", {
        ...args,
        request_id: raceId,
        display_name: "Fictief tweede",
      }),
      manager2.rpc("change_employee_membership_status", {
        ...statusArgs(f),
        request_id: raceId,
      }),
    ]);
    expect(globalRace.filter((r) => r.error === null)).toHaveLength(1);
    expect(globalRace.filter((r) => r.error?.code === "22023")).toHaveLength(1);
    const target = assertLocalUuid(f.employee.membershipId);
    expect(
      ownerSql(`select count(*) from public.memberships where id='${target}'`),
    ).toBe("1");
  } finally {
    await cleanupTeam(f);
  }
});

test("clock-in and suspension produce one valid serialized outcome", async () => {
  const f = await team();
  try {
    const result = await Promise.all([
      f.employeeClient.rpc("clock_in", { request_id: randomUUID() }),
      f.managerClient.rpc("change_employee_membership_status", statusArgs(f)),
    ]);
    expect(result[1].error).toBeNull();
    if (result[1].data.result_code === "suspended") {
      expect(result[0].error?.code).toBe("42501");
      expect(
        ownerSql(
          `select count(*) from public.time_entries where membership_id='${assertLocalUuid(f.employee.membershipId)}' and ended_at is null`,
        ),
      ).toBe("0");
    } else {
      expect(result[1].data.result_code).toBe("open_shift");
      expect(result[0].error).toBeNull();
      expect(
        ownerSql(
          `select status from public.memberships where id='${assertLocalUuid(f.employee.membershipId)}'`,
        ),
      ).toBe("active");
    }
  } finally {
    await cleanupTeam(f);
  }
});

test("v1/v2 exports serialize with profile and worksite updates; stored bytes stay fixed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const f = await team();
  await seedShift(f);
  const manager2 = await session(f.manager.email);
  await protect(page.context());
  try {
    await login(page, f.manager.email, "manager");
    for (const version of [1, 2]) {
      const read = await f.managerClient.rpc("get_manager_team", {
        request_id: randomUUID(),
      });
      expect(read.error).toBeNull();
      const old = read.data.employees[0];
      const args = {
        ...profileArgs(f),
        display_name: `Fictief paar ${version}`,
        employee_code: `PAIR-${version}`,
      };
      const race = await Promise.all([
        f.managerClient.rpc(
          version === 1 ? "create_time_export" : "create_time_export_v2",
          exportArgs(),
        ),
        manager2.rpc("update_employee_profile", args),
      ]);
      expect(race.every((r) => r.error === null)).toBe(true);
      const exportId =
        version === 1 ? race[0].data[0].export_id : race[0].data.manifest.export_id;
      const route = version === 1 ? "exports" : "exports-v2";
      const url = `/manager/${route}/${exportId}/json`;
      const download = await page.request.get(url);
      expect(download.status()).toBe(200);
      const bytes = await download.body();
      const csvUrl = `/manager/${route}/${exportId}/csv`;
      const csvBytes = await (await page.request.get(csvUrl)).body();
      const record = JSON.parse(bytes.toString()).records[0];
      expect([
        [old.display_name, old.employee_code],
        [args.display_name, args.employee_code],
      ]).toContainEqual([record.employee_display_name, record.employee_code]);
      const worksiteRace = await Promise.all([
        f.managerClient.rpc(
          version === 1 ? "create_time_export" : "create_time_export_v2",
          exportArgs(),
        ),
        manager2.rpc("update_pilot_settings", {
          request_id: randomUUID(),
          organization_name: `Fictieve organisatie ${version}`,
          worksite_name: `Fictieve werkplek ${version}`,
        }),
      ]);
      expect(worksiteRace.every((r) => r.error === null)).toBe(true);
      const settingsExport =
        version === 1
          ? worksiteRace[0].data[0].export_id
          : worksiteRace[0].data.manifest.export_id;
      const settingsJson = await (
        await page.request.get(`/manager/${route}/${settingsExport}/json`)
      ).json();
      expect([read.data.worksite_name, `Fictieve werkplek ${version}`]).toContain(
        settingsJson.records[0].worksite_name,
      );
      expect(await (await page.request.get(url)).body()).toEqual(bytes);
      expect(await (await page.request.get(csvUrl)).body()).toEqual(csvBytes);
    }
  } finally {
    await cleanupTeam(f);
  }
});

test("manager authorization expiring during employee lock wait fails closed", async () => {
  test.setTimeout(60_000);
  const f = await team();
  const holder = spawn(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cloxa2",
      "psql",
      "-X",
      "-qAt",
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
    holder.once("error", reject);
  });
  try {
    holder.stdin.write(
      `begin; select pg_advisory_xact_lock(17031,hashtext('${assertLocalUuid(f.employee.userId)}'));\n\\echo LOCK_HELD\n`,
    );
    await held;
    ownerSql(
      `update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where user_id='${assertLocalUuid(f.manager.userId)}'`,
    );
    const args = statusArgs(f);
    const waiting = f.managerClient
      .rpc("change_employee_membership_status", args)
      .then((result: { error: { code: string } | null }) => result);
    await expect
      .poll(() =>
        Number(
          ownerSql(
            "select count(*) from pg_stat_activity where wait_event='advisory' and query like '%change_employee_membership_status%'",
          ),
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        ownerSql(
          `select bool_and(not_after<=clock_timestamp()) from auth.sessions where user_id='${assertLocalUuid(f.manager.userId)}'`,
        ),
      )
      .toBe("t");
    holder.stdin.end("commit;\n");
    expect((await waiting).error?.code).toBe("42501");
    expect(
      ownerSql(
        `select count(*) from private.manager_team_operations where request_id='${args.request_id}'`,
      ),
    ).toBe("0");
    expect(
      ownerSql(
        `select status from public.memberships where id='${assertLocalUuid(f.employee.membershipId)}'`,
      ),
    ).toBe("active");
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\n");
    await cleanupTeam(f);
  }
});
