import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  assertLocalUuid,
  cleanup,
  login,
  ownerSql,
  protect,
  seedShift,
  team,
} from "./phase8-fixtures.mts";

type Fixture = Awaited<ReturnType<typeof team>>;

async function cleanupTeam(fixture: Fixture) {
  // Only this fresh synthetic tenant; the shared teardown removes its other history.
  ownerSql(`begin; set local session_replication_role='replica';
    delete from private.manager_team_operations
      where organization_id='${assertLocalUuid(fixture.organizationId)}'; commit;`);
  await cleanup(fixture);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
}

async function assertSuspendedAccessDenied(page: Page, fixture: Fixture) {
  for (const route of [
    "/employee",
    "/employee/corrections",
    "/employee/break-corrections",
  ]) {
    await page.goto(route);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/unauthorized");
  }
  const clock = await fixture.employeeClient.rpc("clock_in", {
    request_id: randomUUID(),
  });
  expect(clock.error?.code).toBe("42501");
  const organization = await fixture.employeeClient
    .from("organizations")
    .select("id")
    .eq("id", fixture.organizationId);
  expect(organization.error).toBeNull();
  expect(organization.data).toEqual([]);
}

for (const family of ["time", "break"] as const) {
  test(`manager approves suspended employee ${family} correction without restoring access`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    // Shared allocator creates exactly one employee with a deterministic code in
    // each fresh organization, so parallel workers never share a code namespace.
    const fixture = await team();
    const entryId = await seedShift(fixture);
    const size = info.project.name.includes("mobile")
      ? { width: 320, height: 800 }
      : { width: 1280, height: 900 };
    await page.setViewportSize(size);
    await protect(page.context());
    const managerContext = await browser.newContext({ viewport: size });
    await protect(managerContext);
    const manager = await managerContext.newPage();
    const requestTable =
      family === "time" ? "correction_requests" : "break_correction_requests";
    // Phase 8 grants break-history reads to authorized authenticated managers,
    // not service_role. Exercise that existing same-tenant read policy.
    const inspectionClient =
      family === "break" ? fixture.managerClient : fixture.service;
    let unsafeUrl = false;
    let unsafeLog = false;
    for (const current of [page, manager]) {
      current.on("request", (request) => {
        const url = new URL(request.url());
        if (
          /@|%40|access_token=|refresh_token=|password=|token_hash=/iu.test(
            url.search + url.hash,
          )
        )
          unsafeUrl = true;
      });
      current.on("console", (message) => {
        if (
          /example\.test|sb_secret_|eyJ[a-zA-Z0-9_-]{20}|access_token|refresh_token/iu.test(
            message.text(),
          )
        )
          unsafeLog = true;
      });
    }
    try {
      await login(page, fixture.employee.email, "employee");
      if (family === "time") {
        await page.goto("/employee/corrections");
        await page
          .getByTestId("closed-entries")
          .getByRole("button", { name: "Correctie aanvragen", exact: true })
          .click();
        const form = page.getByTestId("correction-form");
        await form.getByLabel("Voorgestelde start").fill("01/01/2010 09:01");
        await form.getByLabel("Voorgesteld einde").fill("01/01/2010 17:00:00.000001");
        await form.getByLabel("Reden", { exact: true }).fill("Fictieve tijdcontrole");
        await form.getByRole("button", { name: "Aanvraag indienen" }).click();
        await expect(page.getByText("Correctieaanvraag ingediend.")).toBeVisible();
      } else {
        await page.goto("/employee/break-corrections");
        await page.getByLabel("Begin pauze", { exact: true }).fill("01/01/2010 13:00");
        await page.getByLabel("Einde pauze", { exact: true }).fill("01/01/2010 13:15");
        await page.getByLabel("Reden", { exact: true }).fill("Fictieve pauzecontrole");
        await page.getByRole("button", { name: "Pauzeaanvraag indienen" }).click();
        await expect(page.getByRole("status")).toHaveText("Pauzeaanvraag ingediend.");
      }
      await noOverflow(page);
      const submitted = await inspectionClient
        .from(requestTable)
        .select("id,status")
        .eq("employee_membership_id", fixture.employee.membershipId)
        .single();
      expect(submitted.error).toBeNull();
      expect(submitted.data.status).toBe("pending");
      const claimId = submitted.data.id;

      await login(manager, fixture.manager.email, "manager");
      await manager.goto("/manager/team");
      const employee = manager.getByRole("article");
      await expect(employee).toHaveCount(1);
      await employee.getByRole("button", { name: "Toegang schorsen" }).click();
      await expect(employee).toContainText(
        family === "time"
          ? "Nog te beoordelen: 1 tijdcorrecties en 0 pauzecorrecties"
          : "Nog te beoordelen: 0 tijdcorrecties en 1 pauzecorrecties",
      );
      await employee.getByRole("checkbox").check();
      await employee
        .getByRole("button", { name: "Schorsing bevestigen", exact: true })
        .click();
      await expect(employee.getByRole("status")).toHaveText(
        "Toegang geschorst. Historische gegevens blijven bewaard.",
      );
      await assertSuspendedAccessDenied(page, fixture);
      const membershipBefore = await fixture.service
        .from("memberships")
        .select("*")
        .eq("id", fixture.employee.membershipId)
        .single();
      expect(membershipBefore.error).toBeNull();
      expect(membershipBefore.data.status).toBe("suspended");

      if (family === "time") {
        await manager.goto("/manager/corrections");
        const pending = manager.getByTestId(`review-${claimId}`);
        await pending.locator("summary").click();
        await pending.getByRole("button", { name: "Goedkeuren", exact: true }).focus();
        await manager.keyboard.press("Enter");
        const dialog = manager.getByRole("dialog", { name: "Voorstel goedkeuren?" });
        await expect(dialog).toBeVisible();
        await noOverflow(manager);
        await dialog.getByRole("button", { name: "Goedkeuren en toepassen" }).click();
        const feedback = manager
          .getByRole("status")
          .filter({ hasText: "Aanvraag goedgekeurd." });
        await expect(feedback).toBeVisible();
        await expect(feedback).toBeFocused();
        await expect(
          manager.getByTestId("review-history").getByTestId(`review-${claimId}`),
        ).toContainText("Goedgekeurd");
        await expect(manager.getByTestId("review-pending")).toHaveCount(0);
      } else {
        await manager.goto("/manager/break-corrections");
        const pending = manager.getByRole("article");
        await expect(pending).toHaveCount(1);
        await expect(pending.getByRole("heading")).toContainText("In afwachting");
        await pending.getByLabel("Beslissing", { exact: true }).selectOption("approve");
        await pending.getByRole("checkbox").check();
        await pending.getByRole("button", { name: "Beslissing bevestigen" }).focus();
        await manager.keyboard.press("Enter");
        await expect(manager.getByRole("status")).toHaveText(
          "Pauzeaanvraag goedgekeurd. Een nieuwe versie is vastgelegd.",
        );
        await expect(manager.getByRole("status")).toBeFocused();
        await expect(pending.getByRole("heading")).toContainText("Goedgekeurd");
        await expect(pending.getByRole("button")).toHaveCount(0);
      }
      await noOverflow(manager);
      const decided = await inspectionClient
        .from(requestTable)
        .select("status")
        .eq("id", claimId)
        .single();
      expect(decided.error).toBeNull();
      expect(decided.data.status).toBe("approved");
      const facts = await inspectionClient
        .from(family === "time" ? "time_entries" : "time_break_revisions")
        .select("started_at,ended_at,version")
        .eq(
          family === "time" ? "id" : "correction_request_id",
          family === "time" ? entryId : claimId,
        )
        .single();
      expect(facts.error).toBeNull();
      expect(facts.data.version).toBe(family === "time" ? 2 : 1);
      expect(Date.parse(facts.data.started_at)).toBe(
        Date.parse(family === "time" ? "2010-01-01T08:01Z" : "2010-01-01T12:00Z"),
      );
      expect(Date.parse(facts.data.ended_at)).toBe(
        Date.parse(family === "time" ? "2010-01-01T16:00Z" : "2010-01-01T12:15Z"),
      );
      const audit = await fixture.service
        .from("audit_events")
        .select("action,before_data,after_data")
        .eq("entity_id", claimId)
        .eq(
          "action",
          `${family === "time" ? "correction_request" : "break_correction_request"}.approved`,
        );
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(1);
      expect(JSON.stringify(audit.data)).not.toMatch(
        /Fictieve|example\.test|employee_reason|manager_note|email|employee_code|display_name|token|session/iu,
      );
      await assertSuspendedAccessDenied(page, fixture);
      const membershipAfter = await fixture.service
        .from("memberships")
        .select("*")
        .eq("id", fixture.employee.membershipId)
        .single();
      expect(membershipAfter.error).toBeNull();
      expect(membershipAfter.data).toEqual(membershipBefore.data);
      expect(unsafeUrl).toBe(false);
      expect(unsafeLog).toBe(false);
    } finally {
      await managerContext.close();
      await cleanupTeam(fixture);
    }
  });
}
