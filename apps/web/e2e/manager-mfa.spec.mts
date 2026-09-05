import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  localOnlyFetch,
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
} from "../../../scripts/local-auth-config.mjs";
import { currentTotp } from "./manager-mfa-fixture.mts";

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
const service = () =>
  createClient(supabaseOrigin, process.env.SUPABASE_SECRET_KEY, options);
const browserClient = () =>
  createClient(
    supabaseOrigin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );

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

function uuid(value: string) {
  if (!/^[0-9a-f-]{36}$/u.test(value))
    throw new Error("Invalid synthetic MFA fixture identifier.");
  return value;
}

async function protect(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    if (![appOrigin, supabaseOrigin].includes(new URL(route.request().url()).origin)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function managerFixture() {
  const admin = service();
  const organizationName = `Private MFA organization ${randomUUID()}`;
  const organization = await admin
    .from("organizations")
    .insert({ name: organizationName, lifecycle_status: "research_pilot" })
    .select("id")
    .single();
  if (organization.error) throw new Error("Synthetic MFA organization failed.");
  const worksite = await admin.from("worksites").insert({
    organization_id: organization.data.id,
    name: "Private MFA worksite",
    timezone: "Europe/Brussels",
  });
  const email = requireFictionalEmail(`mfa.manager.${randomUUID()}@example.test`);
  const user = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { cloxa_local_fixture: "manager-mfa-v1" },
  });
  if (worksite.error || user.error || !user.data.user?.id)
    throw new Error("Synthetic MFA manager failed.");
  const membership = await admin.from("memberships").insert({
    organization_id: organization.data.id,
    user_id: user.data.user.id,
    role: "manager",
    status: "active",
  });
  if (membership.error) throw new Error("Synthetic MFA membership failed.");
  return {
    admin,
    email,
    organizationId: organization.data.id as string,
    organizationName,
    userId: user.data.user.id,
  };
}

async function cleanup(fixture: Awaited<ReturnType<typeof managerFixture>>) {
  const userId = uuid(fixture.userId);
  const organizationId = uuid(fixture.organizationId);
  ownerSql(`begin; set local session_replication_role='replica';
    delete from private.manager_mfa_registrations where auth_user_id='${userId}';
    delete from public.audit_events where organization_id='${organizationId}';
    delete from public.memberships where organization_id='${organizationId}';
    delete from public.worksites where organization_id='${organizationId}';
    delete from public.organizations where id='${organizationId}'; commit;`);
  const deletion = await fixture.admin.auth.admin.deleteUser(userId);
  if (deletion.error) throw new Error("Synthetic MFA cleanup failed.");
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
}

test.beforeEach(async ({ context, page }, testInfo) => {
  await protect(context);
  await page.setViewportSize(
    testInfo.project.name === "chromium-mobile"
      ? { width: 320, height: 900 }
      : { width: 1280, height: 900 },
  );
});

test("manager enrollment, routine login, direct denial and removed-factor recovery", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await managerFixture();
  const aal1 = browserClient();
  const recovery = browserClient();

  try {
    const signedIn = await aal1.auth.signInWithPassword({
      email: fixture.email,
      password,
    });
    expect(signedIn.error).toBeNull();
    expect((await aal1.from("memberships").select("id")).data).toEqual([]);
    expect(
      (await aal1.rpc("get_manager_team", { request_id: randomUUID() })).error?.code,
    ).toBe("42501");

    await login(page, fixture.email);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/setup");
    const deniedDownload = await page.request.get(
      `/manager/exports/${randomUUID()}/json`,
    );
    expect(deniedDownload.status()).toBe(403);
    await expect(page.getByText(fixture.organizationName)).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);

    await page
      .getByRole("button", { name: "Authenticator instellen", exact: true })
      .click();
    await expect(page.getByAltText("QR-code voor authenticator-app")).toBeVisible();
    const secret = (await page.locator("code").textContent())?.trim();
    if (!secret) throw new Error("Synthetic browser TOTP seed is unavailable.");
    const validCode = currentTotp(secret);
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(validCode === "000000" ? "000001" : "000000");
    await page
      .getByRole("button", { name: "Instelling bevestigen", exact: true })
      .click();
    await expect(
      page.getByText(
        "De code kon niet worden gecontroleerd. Controleer de code en probeer later opnieuw.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByLabel("Authenticatorcode", { exact: true }).fill(validCode);
    await page
      .getByRole("button", { name: "Instelling bevestigen", exact: true })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/manager");

    await page.getByRole("button", { name: "Afmelden", exact: true }).click();
    await login(page, fixture.email);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/verify");
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(currentTotp(secret));
    await page.getByRole("button", { name: "Code controleren", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/manager");

    const recoveryLink = await fixture.admin.auth.admin.generateLink({
      type: "recovery",
      email: fixture.email,
    });
    expect(recoveryLink.error).toBeNull();
    const recoveryToken = recoveryLink.data.properties?.hashed_token;
    if (!recoveryToken) throw new Error("Synthetic recovery token is unavailable.");
    const recoverySession = await recovery.auth.verifyOtp({
      type: "recovery",
      token_hash: recoveryToken,
    });
    expect(recoverySession.error).toBeNull();
    const recoveryLevel = await recovery.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(recoveryLevel.error).toBeNull();
    expect(recoveryLevel.data?.currentLevel).toBe("aal1");
    expect(recoveryLevel.data?.nextLevel).toBe("aal2");
    expect((await recovery.from("memberships").select("id")).data).toEqual([]);
    expect(
      (await recovery.rpc("get_manager_team", { request_id: randomUUID() })).error
        ?.code,
    ).toBe("42501");

    const factorId = ownerSql(
      `select provider_factor_id from private.manager_mfa_registrations where auth_user_id='${uuid(fixture.userId)}'`,
    );
    uuid(factorId);
    ownerSql(`delete from auth.mfa_factors where id='${factorId}'`);
    await page.goto("/manager/team");
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/recovery-required");
    await expect(
      page.getByRole("heading", { name: "Herstel door beheerder nodig" }),
    ).toBeVisible();
    await expect(page.getByText(fixture.organizationName)).toHaveCount(0);
  } finally {
    await aal1.auth.signOut().catch(() => {});
    await recovery.auth.signOut().catch(() => {});
    await cleanup(fixture);
  }
});

test("simultaneous native setup attempts keep one registered factor", async () => {
  const fixture = await managerFixture();
  const first = browserClient();
  const second = browserClient();

  try {
    for (const client of [first, second]) {
      const signIn = await client.auth.signInWithPassword({
        email: fixture.email,
        password,
      });
      expect(signIn.error).toBeNull();
    }
    const [firstEnrollment, secondEnrollment] = await Promise.all([
      first.auth.mfa.enroll({ factorType: "totp", friendlyName: "First" }),
      second.auth.mfa.enroll({ factorType: "totp", friendlyName: "Second" }),
    ]);
    if (
      firstEnrollment.error ||
      secondEnrollment.error ||
      !firstEnrollment.data ||
      !secondEnrollment.data
    ) {
      throw new Error("Concurrent synthetic MFA enrollment failed.");
    }

    const attempt = async (
      client: ReturnType<typeof browserClient>,
      enrollment: NonNullable<typeof firstEnrollment.data>,
    ) => {
      const challenge = await client.auth.mfa.challenge({ factorId: enrollment.id });
      if (challenge.error || !challenge.data)
        return { registration: null, verification: challenge.error };
      const verification = await client.auth.mfa.verify({
        factorId: enrollment.id,
        challengeId: challenge.data.id,
        code: currentTotp(enrollment.totp.secret),
      });
      if (verification.error)
        return { registration: null, verification: verification.error };
      return {
        registration: await client.rpc("register_manager_mfa"),
        verification: null,
      };
    };
    const attempts = await Promise.all([
      attempt(first, firstEnrollment.data),
      attempt(second, secondEnrollment.data),
    ]);
    expect(
      attempts.filter((attemptResult) => attemptResult.registration?.data === "ready"),
    ).toHaveLength(1);
    expect(
      ownerSql(
        `select count(*) from private.manager_mfa_registrations where auth_user_id='${uuid(fixture.userId)}'`,
      ),
    ).toBe("1");
    expect(
      ownerSql(
        `select count(*) from public.audit_events where organization_id='${uuid(fixture.organizationId)}' and action='manager_mfa.registered'`,
      ),
    ).toBe("1");
  } finally {
    await cleanup(fixture);
  }
});
