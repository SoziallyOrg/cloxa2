import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { expect, type BrowserContext, type Page } from "@playwright/test";
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

export async function protect(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    if (![appOrigin, supabaseOrigin].includes(new URL(route.request().url()).origin))
      return route.abort("blockedbyclient");
    await route.continue();
  });
}
export function assertLocalUuid(value: string) {
  if (!/^[0-9a-f-]{36}$/u.test(value))
    throw new Error("Invalid synthetic fixture identifier.");
  return value;
}
export function ownerSql(sql: string) {
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
    app_metadata: { cloxa_local_fixture: "historical-break-v2" },
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
      employee_code: role === "employee" ? "SYNREVIEW1234567890123456789012345" : null,
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
export async function session(email: string) {
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
export async function team() {
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
export async function login(page: Page, email: string, role: "manager" | "employee") {
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

export async function seedShift(fixture: Awaited<ReturnType<typeof team>>) {
  const id = randomUUID();
  ownerSql(`insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,ended_at,created_at)
    values('${id}','${assertLocalUuid(fixture.organizationId)}','${assertLocalUuid(fixture.employee.membershipId)}','${assertLocalUuid(fixture.worksiteId)}','2010-01-01 08:00Z','2010-01-01 16:00:00.000001Z','2010-01-01 08:00Z')`);
  return id;
}
export async function cleanup(fixture: Awaited<ReturnType<typeof team>>) {
  const tenant = assertLocalUuid(fixture.organizationId);
  // Synthetic local fixture teardown only. Connection-scoped trigger bypass permits
  // removing circular append-only test history; application RPC tests never use it.
  ownerSql(`begin; set local session_replication_role='replica';
    ${["private.time_export_v2_operations", "private.time_export_v2_snapshots", "public.time_exports_v2", "private.break_correction_decision_operations", "private.break_correction_request_operations", "public.time_break_revisions", "public.break_correction_requests", "private.time_export_creation_operations", "private.time_export_rows", "public.time_exports", "private.manager_decision_operations", "private.correction_request_operations", "public.correction_requests", "private.time_break_operations", "public.time_breaks", "public.time_entries", "public.audit_events"].map((t) => `delete from ${t} where organization_id='${tenant}';`).join("\n")}
    delete from private.time_clock_requests where membership_id in (select id from public.memberships where organization_id='${tenant}');
    delete from private.manager_mfa_registrations where auth_user_id in ('${assertLocalUuid(fixture.manager.userId)}','${assertLocalUuid(fixture.employee.userId)}');
    delete from public.memberships where organization_id='${tenant}';
    delete from public.worksites where organization_id='${tenant}';
    delete from public.organizations where id='${tenant}'; commit;`);
  for (const account of [fixture.manager, fixture.employee]) {
    const result = await fixture.service.auth.admin.deleteUser(account.userId);
    if (result.error) throw new Error("Synthetic fixture cleanup failed.");
  }
}
