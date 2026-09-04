import { randomUUID, createHash } from "node:crypto";
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
function args(entry: string) {
  return {
    request_id: randomUUID(),
    intent: "missed_break",
    entry_id: entry,
    target_id: null,
    expected_parent_version: 1,
    expected_break_version: null,
    start_local: "2010-01-01T13:00:00.000001",
    start_occurrence: "",
    end_local: "2010-01-01T13:30:00.000002",
    end_occurrence: "",
    reason: "Fictieve pauze vergeten",
  };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test("historical break lifecycle, stale claims and immutable v1/v2 downloads", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const f = await team();
  await seedShift(f);
  const size = info.project.name.includes("mobile")
    ? { width: 320, height: 740 }
    : { width: 1280, height: 900 };
  await page.setViewportSize(size);
  page.setDefaultTimeout(10000);
  await protect(page.context());
  const managerContext = await browser.newContext({ viewport: size });
  await protect(managerContext);
  const manager = await managerContext.newPage();
  manager.setDefaultTimeout(10000);
  try {
    const original = await f.managerClient.rpc("create_time_export", {
      request_id: randomUUID(),
      period_start_local: "2010-01-01",
      period_end_local: "2010-01-01",
      confirmed: true,
    });
    expect(original.error).toBeNull();
    const v1id = original.data[0].export_id;
    await login(manager, f.manager.email, "manager");
    const v1before = await manager.request.get(`/manager/exports/${v1id}/json`);
    expect(v1before.status()).toBe(200);
    const v1bytes = await v1before.body();
    await login(page, f.employee.email, "employee");
    await page.getByRole("link", { name: "Pauzes corrigeren", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Nieuwe pauzeaanvraag" }),
    ).toBeVisible();
    await page
      .getByLabel("Begin pauze", { exact: true })
      .fill("01/01/2010 13:00:00.000001");
    await page
      .getByLabel("Einde pauze", { exact: true })
      .fill("01/01/2010 13:30:00.000002");
    await page.getByLabel("Reden", { exact: true }).fill("Fictieve pauze vergeten");
    await page.getByRole("button", { name: "Pauzeaanvraag indienen" }).click();
    await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingediend.");
    await expect(page.getByRole("status")).toBeFocused();
    await manager.goto("/manager/break-corrections");
    const pending = () =>
      manager
        .getByRole("article")
        .filter({ has: manager.getByRole("heading", { name: /In afwachting/ }) });
    await expect(pending()).toHaveCount(1);
    await noOverflow(page);
    await noOverflow(manager);
    await mkdir(".impeccable/review/phase8", { recursive: true });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `.impeccable/review/phase8/employee-${size.width}.png`,
      fullPage: true,
      animations: "disabled",
      scale: "css",
    });
    await manager.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await manager.screenshot({
      path: `.impeccable/review/phase8/manager-${size.width}.png`,
      fullPage: true,
      animations: "disabled",
      scale: "css",
    });
    async function decide(decision: "approve" | "reject") {
      await pending().getByLabel("Beslissing", { exact: true }).selectOption(decision);
      if (decision === "reject")
        await pending()
          .getByLabel("Toelichting (verplicht)", { exact: true })
          .fill("Fictieve afwijzing");
      await pending().getByRole("checkbox").check();
      await pending().getByRole("button", { name: "Beslissing bevestigen" }).click();
      await expect(pending()).toHaveCount(0);
      await expect(manager.getByRole("status")).toBeFocused();
    }
    await decide("approve");
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Geldende pauzes en totalen" }),
    ).toContainText("0 u 30 min 00,000001 s");
    // Snapshot captures first approved revision before later adjustment/removal.
    await manager.goto("/manager/exports-v2");
    await manager.getByLabel("Van", { exact: true }).fill("2010-01-01");
    await manager.getByLabel("Tot en met", { exact: true }).fill("2010-01-01");
    await manager.getByRole("button", { name: "Voorbeeld laden" }).click();
    await expect(
      manager.getByRole("heading", { name: "Voorbeeld: 1 werkperiodes" }),
    ).toBeVisible();
    await manager.getByLabel("Tot en met", { exact: true }).fill("2010-01-02");
    await expect(
      manager.getByRole("heading", { name: "Voorbeeld: 1 werkperiodes" }),
    ).toHaveCount(0);
    await expect(manager.getByRole("checkbox")).toHaveCount(0);
    await manager.getByLabel("Tot en met", { exact: true }).fill("2010-01-01");
    await manager.getByRole("button", { name: "Voorbeeld laden" }).click();
    await expect(
      manager.getByRole("heading", { name: "Voorbeeld: 1 werkperiodes" }),
    ).toBeVisible();
    await manager
      .getByText("Feitelijke versies en pauzes bekijken", { exact: true })
      .click();
    await noOverflow(manager);
    await manager.getByRole("checkbox").check();
    await manager.getByRole("button", { name: "Export v2 bevestigen" }).click();
    await expect(manager.getByRole("status")).toHaveText("Export v2 vastgelegd.");
    await expect(manager.getByRole("status")).toBeFocused();
    const newExport = manager.getByRole("region", { name: "Nieuwe export" });
    const jsonHref = await newExport
      .getByRole("link", { name: "Download JSON" })
      .getAttribute("href");
    const csvHref = await newExport
      .getByRole("link", { name: "Download CSV" })
      .getAttribute("href");
    const json = await manager.request.get(jsonHref!);
    const body = await json.body();
    expect(json.status()).toBe(200);
    expect(json.headers()["x-cloxa-artifact-sha256"]).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    const artifact = JSON.parse(body.toString());
    expect(artifact.records[0].unpaid_break_duration_microseconds).toBe("1800000001");
    expect(artifact.records[0].net_worked_duration_microseconds).toBe("27000000000");
    const csv = await manager.request.get(csvHref!);
    expect(csv.status()).toBe(200);
    expect((await csv.body()).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    for (const format of ["CSV", "JSON"]) {
      const download = manager.waitForEvent("download");
      await newExport.getByRole("link", { name: `Download ${format}` }).click();
      expect((await download).suggestedFilename()).toContain("cloxa-time-export-v2");
    }
    await manager.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await manager.screenshot({
      path: `.impeccable/review/phase8/export-${size.width}.png`,
      fullPage: true,
      animations: "disabled",
      scale: "css",
    });
    await page.getByLabel("Soort aanvraag", { exact: true }).selectOption("adjustment");
    await page.getByLabel("Pauze", { exact: true }).selectOption({ index: 1 });
    await page
      .getByLabel("Einde pauze", { exact: true })
      .fill("01/01/2010 13:45:00.000002");
    await page.getByLabel("Reden", { exact: true }).fill("Fictieve duur aanpassen");
    await page.getByRole("button", { name: "Pauzeaanvraag indienen" }).click();
    await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingediend.");
    await manager.goto("/manager/break-corrections");
    await decide("approve");
    await page.reload();
    await page.getByLabel("Soort aanvraag", { exact: true }).selectOption("removal");
    await page.getByLabel("Pauze", { exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Reden", { exact: true }).fill("Fictieve onterechte pauze");
    await page.getByRole("button", { name: "Pauzeaanvraag indienen" }).click();
    await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingediend.");
    await manager.reload();
    await decide("approve");
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Geldende pauzes en totalen" }),
    ).toContainText("Verwijderd uit de geldende tijd");
    expect(await (await manager.request.get(jsonHref!)).body()).toEqual(body);
    expect(
      await (await manager.request.get(`/manager/exports/${v1id}/json`)).body(),
    ).toEqual(v1bytes);
    expect(
      (
        await f.managerClient.rpc("create_time_export", {
          request_id: randomUUID(),
          period_start_local: "2010-01-01",
          period_end_local: "2010-01-01",
          confirmed: true,
        })
      ).data[0].result_code,
    ).toBe("break_data_requires_v2");
    // Withdrawal and rejection leave facts unchanged.
    async function missed(reason: string) {
      await page
        .getByLabel("Soort aanvraag", { exact: true })
        .selectOption("missed_break");
      await page.getByLabel("Begin pauze", { exact: true }).fill("01/01/2010 14:00");
      await page.getByLabel("Einde pauze", { exact: true }).fill("01/01/2010 14:15");
      await page.getByLabel("Reden", { exact: true }).fill(reason);
      await page.getByRole("button", { name: "Pauzeaanvraag indienen" }).click();
      await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingediend.");
    }
    await missed("Fictief intrekken");
    await page.getByRole("button", { name: "Aanvraag intrekken" }).click();
    await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingetrokken.");
    await missed("Fictief afwijzen");
    await manager.reload();
    await decide("reject");
    await page.reload();
    await expect(
      page.getByText("Toelichting beheerder: Fictieve afwijzing"),
    ).toBeVisible();
    await missed("Fictieve verouderde aanvraag");
    ownerSql(
      `update public.time_entries set started_at=started_at+interval '1 minute' where organization_id='${assertLocalUuid(f.organizationId)}'; update public.time_entries set started_at=started_at-interval '1 minute' where organization_id='${assertLocalUuid(f.organizationId)}'`,
    );
    await manager.reload();
    await expect(
      pending().getByText("Verouderde aanvraag. De vastgelegde versie is veranderd."),
    ).toBeVisible();
    await expect(
      pending().getByRole("button", { name: "Beslissing bevestigen" }),
    ).toBeDisabled();
    await decide("reject");
    await noOverflow(page);
    await noOverflow(manager);
    expect((await page.request.get(jsonHref!)).status()).toBe(404);
    expect(
      (await manager.request.get("/manager/exports-v2/not-a-uuid/json")).status(),
    ).toBe(404);
  } finally {
    await managerContext.close().catch(() => {});
    await cleanup(f);
  }
});

test("concurrent decisions, shift corrections, clock and exports have serial outcomes", async () => {
  test.setTimeout(90_000);
  const f = await team();
  const entry = await seedShift(f);
  const employee2 = await session(f.employee.email);
  const manager2 = await session(f.manager.email);
  try {
    const request = args(entry);
    const duplicates = await Promise.all([
      f.employeeClient.rpc("change_break_correction", request),
      employee2.rpc("change_break_correction", request),
    ]);
    expect(duplicates[0].error).toBeNull();
    expect(duplicates[0].data).toEqual(duplicates[1].data);
    const claim = duplicates[0].data.correction_request_id;
    const decisions = await Promise.all([
      f.managerClient.rpc("decide_break_correction", {
        request_id: randomUUID(),
        correction_request_id: claim,
        decision: "approve",
        manager_note: "",
        confirmed: true,
      }),
      manager2.rpc("decide_break_correction", {
        request_id: randomUUID(),
        correction_request_id: claim,
        decision: "reject",
        manager_note: "Fictief",
        confirmed: true,
      }),
    ]);
    expect(decisions.every((r) => r.error === null)).toBe(true);
    expect(decisions.map((r) => r.data.result_code)).toContain("already_terminal");
    const breakClaim = {
      ...args(entry),
      start_local: "2010-01-01T14:00",
      end_local: "2010-01-01T14:15",
    };
    const shift = {
      request_id: randomUUID(),
      request_kind: "adjustment",
      target_time_entry_id: entry,
      proposed_start_local: "2010-01-01T09:01",
      proposed_start_occurrence: "",
      proposed_end_local: "2010-01-01T17:00:00.000001",
      proposed_end_occurrence: "",
      employee_reason: "Fictief",
    };
    const race = await Promise.all([
      f.employeeClient.rpc("change_break_correction", breakClaim),
      employee2.rpc("submit_employee_correction_request", shift),
    ]);
    const breakWon = race[0].data?.result_code === "submitted";
    if (breakWon) expect(race[1].error?.message).toBe("correction_pending_conflict");
    else {
      expect(race[1].error).toBeNull();
      expect(race[0].data.result_code).toBe("pending_time_correction");
    }
    const exports = await Promise.all([
      f.managerClient.rpc("create_time_export_v2", {
        request_id: randomUUID(),
        period_start_local: "2010-01-01",
        period_end_local: "2010-01-01",
        confirmed: true,
      }),
      breakWon
        ? manager2.rpc("decide_break_correction", {
            request_id: randomUUID(),
            correction_request_id: race[0].data.correction_request_id,
            decision: "approve",
            manager_note: "",
            confirmed: true,
          })
        : manager2.rpc("decide_correction_request", {
            request_id: randomUUID(),
            correction_request_id: race[1].data[0].correction_request_id,
            decision: "approve",
            manager_note: "",
          }),
      employee2.rpc("clock_in", { request_id: randomUUID() }),
    ]);
    expect(exports.every((r) => r.error === null)).toBe(true);
    expect(["created", "pending_break_correction", "pending_correction"]).toContain(
      exports[0].data.result_code,
    );
    expect(
      (await f.employeeClient.rpc("clock_out", { request_id: randomUUID() })).error,
    ).toBeNull();
    expect(
      ownerSql(
        `select count(*) from (select logical_break_id,version,count(*) from public.time_break_revisions where organization_id='${assertLocalUuid(f.organizationId)}' group by logical_break_id,version having count(*)>1) x`,
      ),
    ).toBe("0");
  } finally {
    await cleanup(f);
  }
});

test("expired authorization after lock wait leaves no break operation", async () => {
  test.setTimeout(60_000);
  const f = await team();
  const entry = await seedShift(f);
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
    holder.stdout.on("data", (d: Buffer) => {
      if (d.toString().includes("LOCK_HELD")) resolve();
    });
    holder.once("error", reject);
  });
  try {
    holder.stdin.write(
      `begin; select pg_advisory_xact_lock(17031,hashtext('${assertLocalUuid(f.employee.userId)}'));\n\\echo LOCK_HELD\n`,
    );
    await held;
    ownerSql(
      `update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where user_id='${assertLocalUuid(f.employee.userId)}'`,
    );
    const request = args(entry);
    const waiting = f.employeeClient
      .rpc("change_break_correction", request)
      .then((r: { error: { code: string } | null }) => r);
    await expect
      .poll(() =>
        Number(
          ownerSql(
            "select count(*) from pg_stat_activity where wait_event='advisory' and query like '%change_break_correction%'",
          ),
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        ownerSql(
          `select bool_and(not_after<=clock_timestamp()) from auth.sessions where user_id='${assertLocalUuid(f.employee.userId)}'`,
        ),
      )
      .toBe("t");
    holder.stdin.end("commit;\n");
    expect((await waiting).error?.code).toBe("42501");
    expect(
      ownerSql(
        `select count(*) from private.break_correction_request_operations where request_id='${request.request_id}'`,
      ),
    ).toBe("0");
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\n");
    await cleanup(f);
  }
});
