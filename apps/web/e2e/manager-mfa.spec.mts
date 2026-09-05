import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  localOnlyFetch,
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
} from "../../../scripts/local-auth-config.mjs";
import {
  executeRecoveryCommand,
  operatorDatabase,
} from "../../../scripts/local-manager-mfa-recovery.mjs";
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
const resetPassword = requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
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

function ownerSqlAsync(sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
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
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", () => reject(new Error("Concurrent local SQL failed.")));
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error("Concurrent local SQL was rejected."));
    });
    child.stdin.end(sql);
  });
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
    delete from private.manager_mfa_recovery_candidates where auth_user_id='${userId}';
    delete from private.manager_mfa_recovery_cases where auth_user_id='${userId}';
    delete from private.manager_mfa_registrations where auth_user_id='${userId}';
    delete from public.audit_events where organization_id='${organizationId}';
    delete from public.memberships where organization_id='${organizationId}';
    delete from public.worksites where organization_id='${organizationId}';
    delete from public.organizations where id='${organizationId}'; commit;`);
  const deletion = await fixture.admin.auth.admin.deleteUser(userId);
  if (deletion.error) throw new Error("Synthetic MFA cleanup failed.");
}

async function login(page: Page, email: string, loginPassword = password) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(loginPassword);
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

test("controlled native recovery keeps password reset and old sessions fail-closed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await managerFixture();
  const initial = browserClient();
  const afterPasswordReset = browserClient();
  const candidate = browserClient();
  const fresh = browserClient();

  try {
    const initialLogin = await initial.auth.signInWithPassword({
      email: fixture.email,
      password,
    });
    expect(initialLogin.error).toBeNull();
    const oldEnrollment = await initial.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Registered before recovery",
      issuer: "Cloxa",
    });
    if (oldEnrollment.error || !oldEnrollment.data)
      throw new Error("Synthetic registered factor enrollment failed.");
    const oldChallenge = await initial.auth.mfa.challenge({
      factorId: oldEnrollment.data.id,
    });
    if (oldChallenge.error || !oldChallenge.data)
      throw new Error("Synthetic registered factor challenge failed.");
    const oldVerification = await initial.auth.mfa.verify({
      factorId: oldEnrollment.data.id,
      challengeId: oldChallenge.data.id,
      code: currentTotp(oldEnrollment.data.totp.secret),
    });
    expect(oldVerification.error).toBeNull();
    expect((await initial.rpc("register_manager_mfa")).data).toBe("ready");
    const oldBinding = ownerSql(
      `select provider_factor_id from private.manager_mfa_registrations where auth_user_id='${uuid(fixture.userId)}'`,
    );
    expect(oldBinding).toBe(oldEnrollment.data.id);

    const recoveryLink = await fixture.admin.auth.admin.generateLink({
      type: "recovery",
      email: fixture.email,
    });
    const recoveryToken = recoveryLink.data.properties?.hashed_token;
    if (recoveryLink.error || !recoveryToken)
      throw new Error("Synthetic manager recovery link failed.");
    await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(recoveryToken)}&type=recovery`,
    );
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password");
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(currentTotp(oldEnrollment.data.totp.secret));
    await page.getByRole("button", { name: "Code controleren" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password");
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toBeVisible();
    await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill(resetPassword);
    await page
      .getByLabel("Herhaal nieuw wachtwoord", { exact: true })
      .fill(resetPassword);
    await page.getByRole("button", { name: "Wachtwoord opslaan" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
    expect(
      ownerSql(
        `select provider_factor_id from private.manager_mfa_registrations where auth_user_id='${uuid(fixture.userId)}'`,
      ),
    ).toBe(oldBinding);
    expect(
      ownerSql(
        `select count(*) from private.manager_mfa_recovery_cases where auth_user_id='${uuid(fixture.userId)}'`,
      ),
    ).toBe("0");
    await login(page, fixture.email, resetPassword);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/verify");
    expect(
      (await page.request.get(`/manager/exports/${randomUUID()}/json`)).status(),
    ).toBe(403);
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(currentTotp(oldEnrollment.data.totp.secret));
    await page.getByRole("button", { name: "Code controleren" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/manager");

    const passwordLogin = await afterPasswordReset.auth.signInWithPassword({
      email: fixture.email,
      password: resetPassword,
    });
    expect(passwordLogin.error).toBeNull();
    expect((await afterPasswordReset.from("memberships").select("id")).data).toEqual(
      [],
    );
    expect(
      (
        await afterPasswordReset.rpc("get_manager_team", {
          request_id: randomUUID(),
        })
      ).error?.code,
    ).toBe("42501");
    const passwordChallenge = await afterPasswordReset.auth.mfa.challenge({
      factorId: oldEnrollment.data.id,
    });
    if (passwordChallenge.error || !passwordChallenge.data)
      throw new Error("Post-reset registered factor challenge failed.");
    expect(
      (
        await afterPasswordReset.auth.mfa.verify({
          factorId: oldEnrollment.data.id,
          challengeId: passwordChallenge.data.id,
          code: currentTotp(oldEnrollment.data.totp.secret),
        })
      ).error,
    ).toBeNull();
    expect(
      (await afterPasswordReset.from("memberships").select("id")).data,
    ).toHaveLength(1);
    const staleSession = (await afterPasswordReset.auth.getSession()).data.session;
    if (!staleSession) throw new Error("Synthetic stale session is unavailable.");
    const startOperation = randomUUID();
    const started = await executeRecoveryCommand(
      {
        command: "start",
        operationId: startOperation,
        targetUserId: fixture.userId,
      },
      { admin: fixture.admin, database: operatorDatabase() },
    );
    expect(started.status).toBe("awaiting_candidate");
    const recoveryCaseId = uuid(started.case_id);
    expect(
      (await fixture.admin.auth.admin.mfa.listFactors({ userId: fixture.userId })).data
        .factors,
    ).toEqual([]);

    const staleResponse = await fetch(
      new URL("/rest/v1/memberships?select=id", supabaseOrigin),
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          authorization: `Bearer ${staleSession.access_token}`,
        },
        redirect: "error",
      },
    );
    expect([200, 401]).toContain(staleResponse.status);
    if (staleResponse.ok) expect(await staleResponse.json()).toEqual([]);

    await login(page, fixture.email, resetPassword);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/recovery-required");
    await expect(page.getByText(/herstelvenster van 15 minuten/u)).toBeVisible();
    await page
      .getByRole("button", {
        name: "Vervangende authenticator instellen",
        exact: true,
      })
      .click();
    const replacementSecret = (await page.locator("code").textContent())?.trim();
    const replacementFactorId = await page
      .locator('input[name="factorId"]')
      .inputValue();
    if (!replacementSecret || !replacementFactorId)
      throw new Error("Synthetic replacement enrollment is unavailable.");
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(currentTotp(replacementSecret));
    await page.getByRole("button", { name: "Instelling bevestigen" }).click();
    await expect(
      page.getByText(/Toegang blijft geblokkeerd tot een lokale beheerder/u),
    ).toBeVisible();
    const displayedCandidateId = (await page.locator("code").textContent())?.trim();
    uuid(displayedCandidateId ?? "");
    expect(new URL(page.url()).search).not.toMatch(/secret|code|factor|candidate/iu);
    expect(
      (await page.request.get(`/manager/exports-v2/${randomUUID()}/json`)).status(),
    ).toBe(403);

    const candidateLogin = await candidate.auth.signInWithPassword({
      email: fixture.email,
      password: resetPassword,
    });
    expect(candidateLogin.error).toBeNull();
    const candidateChallenge = await candidate.auth.mfa.challenge({
      factorId: replacementFactorId,
    });
    if (candidateChallenge.error || !candidateChallenge.data)
      throw new Error("Replacement candidate challenge failed.");
    expect(
      (
        await candidate.auth.mfa.verify({
          factorId: replacementFactorId,
          challengeId: candidateChallenge.data.id,
          code: currentTotp(replacementSecret),
        })
      ).error,
    ).toBeNull();
    const recordedCandidate = await candidate.rpc(
      "record_manager_mfa_recovery_candidate",
      { target_case_id: recoveryCaseId },
    );
    if (recordedCandidate.error || !recordedCandidate.data)
      throw new Error("Replacement candidate recording failed.");
    const approvedCandidateId = uuid(recordedCandidate.data);
    expect((await candidate.from("memberships").select("id")).data).toEqual([]);
    expect(
      (await candidate.rpc("get_manager_team", { request_id: randomUUID() })).error
        ?.code,
    ).toBe("42501");

    const completionOperation = randomUUID();
    const completed = await executeRecoveryCommand(
      {
        candidateId: approvedCandidateId,
        caseId: recoveryCaseId,
        command: "complete",
        operationId: completionOperation,
        targetUserId: fixture.userId,
      },
      { admin: fixture.admin, database: operatorDatabase() },
    );
    expect(completed.status).toBe("completed");
    expect((await candidate.from("memberships").select("id")).data).toEqual([]);
    const refreshed = await candidate.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect((await candidate.from("memberships").select("id")).data).toEqual([]);

    const freshLogin = await fresh.auth.signInWithPassword({
      email: fixture.email,
      password: resetPassword,
    });
    expect(freshLogin.error).toBeNull();
    expect((await fresh.from("memberships").select("id")).data).toEqual([]);
    const freshChallenge = await fresh.auth.mfa.challenge({
      factorId: replacementFactorId,
    });
    if (freshChallenge.error || !freshChallenge.data)
      throw new Error("Fresh replacement factor challenge failed.");
    expect(
      (
        await fresh.auth.mfa.verify({
          factorId: replacementFactorId,
          challengeId: freshChallenge.data.id,
          code: currentTotp(replacementSecret),
        })
      ).error,
    ).toBeNull();
    expect((await fresh.from("memberships").select("id")).data).toHaveLength(1);

    await login(page, fixture.email, resetPassword);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/manager/security/verify");
    await page
      .getByLabel("Authenticatorcode", { exact: true })
      .fill(currentTotp(replacementSecret));
    await page.getByRole("button", { name: "Code controleren" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/manager");
  } finally {
    for (const client of [initial, afterPasswordReset, candidate, fresh]) {
      await client.auth.signOut().catch(() => {});
    }
    await cleanup(fixture);
  }
});

test("concurrent operator transitions keep one start and one completion", async () => {
  const fixture = await managerFixture();
  const manager = browserClient();

  try {
    expect(
      (
        await manager.auth.signInWithPassword({
          email: fixture.email,
          password,
        })
      ).error,
    ).toBeNull();
    const oldEnrollment = await manager.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Concurrency old factor",
      issuer: "Cloxa",
    });
    if (oldEnrollment.error || !oldEnrollment.data)
      throw new Error("Concurrency old factor enrollment failed.");
    const oldChallenge = await manager.auth.mfa.challenge({
      factorId: oldEnrollment.data.id,
    });
    if (oldChallenge.error || !oldChallenge.data)
      throw new Error("Concurrency old factor challenge failed.");
    expect(
      (
        await manager.auth.mfa.verify({
          factorId: oldEnrollment.data.id,
          challengeId: oldChallenge.data.id,
          code: currentTotp(oldEnrollment.data.totp.secret),
        })
      ).error,
    ).toBeNull();
    expect((await manager.rpc("register_manager_mfa")).data).toBe("ready");

    const startOperations = [randomUUID(), randomUUID()];
    const starts = await Promise.allSettled(
      startOperations.map((operationId) =>
        ownerSqlAsync(
          `select private.start_local_manager_mfa_recovery('${uuid(fixture.userId)}','${uuid(operationId)}')::text;`,
        ),
      ),
    );
    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(starts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      ownerSql(
        `select count(*) from private.manager_mfa_recovery_cases where auth_user_id='${uuid(fixture.userId)}'`,
      ),
    ).toBe("1");
    expect(
      ownerSql(
        `select count(*) from public.audit_events where organization_id='${uuid(fixture.organizationId)}' and action='manager_mfa.recovery_started'`,
      ),
    ).toBe("1");
    const startIndex = starts.findIndex((result) => result.status === "fulfilled");
    const startOperation = startOperations[startIndex]!;
    const recoveryCaseId = uuid(
      JSON.parse((starts[startIndex] as PromiseFulfilledResult<string>).value).case_id,
    );

    const deletion = await fixture.admin.auth.admin.mfa.deleteFactor({
      id: oldEnrollment.data.id,
      userId: fixture.userId,
    });
    expect(deletion.error).toBeNull();
    operatorDatabase().providerResult({
      caseId: recoveryCaseId,
      expectedFactorId: oldEnrollment.data.id,
      operationId: startOperation,
      removalSucceeded: true,
      targetUserId: fixture.userId,
    });

    expect(
      (
        await manager.auth.signInWithPassword({
          email: fixture.email,
          password,
        })
      ).error,
    ).toBeNull();
    const replacement = await manager.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Concurrency replacement",
      issuer: "Cloxa",
    });
    if (replacement.error || !replacement.data)
      throw new Error("Concurrency replacement enrollment failed.");
    const replacementChallenge = await manager.auth.mfa.challenge({
      factorId: replacement.data.id,
    });
    if (replacementChallenge.error || !replacementChallenge.data)
      throw new Error("Concurrency replacement challenge failed.");
    expect(
      (
        await manager.auth.mfa.verify({
          factorId: replacement.data.id,
          challengeId: replacementChallenge.data.id,
          code: currentTotp(replacement.data.totp.secret),
        })
      ).error,
    ).toBeNull();
    const candidate = await manager.rpc("record_manager_mfa_recovery_candidate", {
      target_case_id: recoveryCaseId,
    });
    if (candidate.error || !candidate.data)
      throw new Error("Concurrency candidate recording failed.");

    const completionOperation = randomUUID();
    const completionSql =
      `select private.complete_local_manager_mfa_recovery('${uuid(fixture.userId)}',` +
      `'${recoveryCaseId}','${uuid(candidate.data)}','${uuid(completionOperation)}')::text;`;
    const completions = await Promise.allSettled([
      ownerSqlAsync(completionSql),
      ownerSqlAsync(completionSql),
    ]);
    expect(completions.every((result) => result.status === "fulfilled")).toBe(true);
    expect(
      ownerSql(
        `select count(*) from public.audit_events where organization_id='${uuid(fixture.organizationId)}' and action='manager_mfa.recovery_completed'`,
      ),
    ).toBe("1");
    expect(
      ownerSql(
        `select generation from private.manager_mfa_registrations where auth_user_id='${uuid(fixture.userId)}'`,
      ),
    ).toBe("2");
  } finally {
    await manager.auth.signOut().catch(() => {});
    await cleanup(fixture);
  }
});
