import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  checkBrowserBundles,
  containsServerSecret,
} from "../../../scripts/local-auth-bundles.mjs";
import {
  requireLiteralLoopbackOrigin,
  requireLocalOrigin,
  requireLocalPassword,
} from "../../../scripts/local-auth-config.mjs";
import {
  claimLocalAuthEmployee,
  cleanupLocalAuthE2eLease,
  createLocalAuthE2eLease,
  createLocalAuthE2eOperation,
  createLocalAuthFixtureFetch,
  createLocalAuthFixtureDatabase,
  createSupabaseFixtureStore,
  localAuthFixtureDeadlines,
  markLocalAuthInvitationAttempted,
  prepareLocalAuthEmployeeInvitation,
  provisionLocalAuthManager,
  verifyAcceptedLocalAuthEmployee,
} from "../../../scripts/local-auth-e2e-fixture.mjs";
import {
  runOperatorSqlAsync,
  validateLocalOperatorEnvironment,
} from "../../../scripts/local-manager-mfa-recovery.mjs";
import { currentTotp } from "./manager-mfa-fixture.mts";

const employeePassword = requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
);
const resetPassword = requireLocalPassword(
  process.env.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD,
  "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
);
const appOrigin = requireLocalOrigin(process.env.CLOXA_SITE_URL, "App URL");
const mailpitOrigin = requireLiteralLoopbackOrigin(
  process.env.CLOXA_LOCAL_MAILPIT_URL,
  "Mailpit URL",
);
const supabaseOrigin = requireLiteralLoopbackOrigin(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "Supabase URL",
);
const requireFromWeb = createRequire(new URL("../package.json", import.meta.url));
const { createClient } = requireFromWeb("@supabase/supabase-js");
let fixtureSettingsPromise:
  ReturnType<typeof validateLocalOperatorEnvironment> | undefined;

type MailMessage = { ID: string; HTML: string; To: Array<{ Address: string }> };
type MailSummary = { ID: string; To: Array<{ Address: string }> };

async function fixtureRuntime(lease: ReturnType<typeof createLocalAuthE2eLease>) {
  fixtureSettingsPromise ??= validateLocalOperatorEnvironment();
  const settings = await fixtureSettingsPromise;
  if (settings.supabaseUrl !== supabaseOrigin) {
    throw new Error("Lokale fixture-stack wijkt af van de browserconfiguratie.");
  }
  const operation = createLocalAuthE2eOperation(lease, {
    timeoutMs: localAuthFixtureDeadlines.operationMs,
  });
  const admin = createClient(settings.supabaseUrl, settings.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: createLocalAuthFixtureFetch({ signal: operation.signal }),
    },
  });
  return {
    database: createLocalAuthFixtureDatabase({
      dockerEndpoint: settings.dockerEndpoint,
      dockerEnvironment: settings.dockerEnvironment,
      runSql: runOperatorSqlAsync,
      timeoutMs: localAuthFixtureDeadlines.sqlMs,
    }),
    operation,
    store: createSupabaseFixtureStore(admin, { signal: operation.signal }),
  };
}

async function withDisposableManager(
  journey: (context: {
    lease: ReturnType<typeof createLocalAuthE2eLease>;
    store: ReturnType<typeof createSupabaseFixtureStore>;
  }) => Promise<void>,
) {
  const lease = createLocalAuthE2eLease();
  const runtime = await fixtureRuntime(lease);
  let failure: unknown;

  try {
    await provisionLocalAuthManager(lease, {
      password: employeePassword,
      store: runtime.store,
    });
    await journey({ lease, store: runtime.store });
  } catch (error) {
    failure = error;
  }

  const cleanup = await cleanupLocalAuthE2eLease(lease, runtime);
  if (cleanup.status !== "cleaned") {
    runtime.operation.abort();
    const cleanupFailure = new Error(
      `Lokale testfixture is veilig bewaard (${cleanup.remaining.join(", ")}).`,
    );
    if (failure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        "Lokale Auth-journey en veilige fixture-opruiming zijn mislukt.",
      );
    }
    throw cleanupFailure;
  }
  runtime.operation.finish();
  if (failure) throw failure;
}

async function blockExternalRequests(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;

    if (![appOrigin, supabaseOrigin].includes(origin)) {
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  await context.routeWebSocket("**/*", async (route) => {
    const origin = new URL(route.url()).origin;
    const allowed = [appOrigin, supabaseOrigin].map((value) =>
      value.replace(/^http/u, "ws"),
    );
    if (!allowed.includes(origin)) {
      await route.close({ code: 1008, reason: "Non-local destinations are blocked" });
      return;
    }
    route.connectToServer();
  });
}

function parsePrivateEmailLink(value: string) {
  try {
    return new URL(value.replaceAll("&amp;", "&"));
  } catch {
    throw new Error("Lokale Auth-mail bevat geen geldige link.");
  }
}

async function privateFill(locator: Locator, value: string) {
  await expect(locator).toBeVisible();

  try {
    await locator.fill(value);
  } catch {
    throw new Error("Invullen van lokaal testveld is mislukt.");
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await privateFill(page.getByLabel("E-mailadres", { exact: true }), email);
  await privateFill(page.getByLabel("Wachtwoord", { exact: true }), password);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
}

async function expectPath(page: Page, pathname: string) {
  // Never include a complete email-link URL in assertion failures.
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
}

async function waitForLocalEmailLink(email: string, type: "invite" | "recovery") {
  let link: string | undefined;

  await expect
    .poll(
      async () => {
        const search = new URL("/api/v1/search", mailpitOrigin);
        search.searchParams.set("query", `to:${email}`);
        const response = await fetch(search, { redirect: "error" });

        if (!response.ok) {
          return false;
        }

        const data = (await response.json()) as { messages?: MailSummary[] };

        for (const summary of data.messages ?? []) {
          if (
            !summary.To.some((recipient) => recipient.Address.toLowerCase() === email)
          ) {
            continue;
          }

          const messageResponse = await fetch(
            new URL(`/api/v1/message/${encodeURIComponent(summary.ID)}`, mailpitOrigin),
            { redirect: "error" },
          );

          if (!messageResponse.ok) {
            continue;
          }

          const message = (await messageResponse.json()) as MailMessage;

          for (const match of message.HTML.matchAll(/href="([^"]+)"/gu)) {
            const candidate = parsePrivateEmailLink(match[1]!);

            if (
              candidate.origin !== appOrigin ||
              candidate.pathname !== "/auth/callback"
            ) {
              throw new Error("Lokale testmail bevat een onverwachte bestemming.");
            }

            if (
              candidate.searchParams.get("type") === type &&
              candidate.searchParams.has("token_hash")
            ) {
              link = candidate.toString();
              return true;
            }
          }
        }

        return false;
      },
      {
        message: "Lokale Auth-mail beschikbaar",
        timeout: 20_000,
        intervals: [250, 500, 1000],
      },
    )
    .toBe(true);

  if (!link) {
    throw new Error("Lokale Auth-mail ontbreekt.");
  }

  return link;
}

async function followPrivateLink(page: Page, link: string) {
  try {
    await page.goto(link);
  } catch {
    throw new Error("Lokale Auth-link openen is mislukt.");
  }
}

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

test("volledige lokale uitnodiging, aanmelding en wachtwoordherstel", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await withDisposableManager(async ({ lease, store }) => {
    await login(page, lease.manager.email, employeePassword);
    await expectPath(page, "/manager/security/setup");
    await expect(
      page.getByRole("heading", { level: 1, name: "Authenticator instellen" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Authenticator instellen", exact: true })
      .click();
    const totpSecret = (await page.locator("code").textContent())?.trim();
    if (!totpSecret) throw new Error("Lokale TOTP-sleutel ontbreekt.");
    await privateFill(
      page.getByLabel("Authenticatorcode", { exact: true }),
      currentTotp(totpSecret),
    );
    await page
      .getByRole("button", { name: "Instelling bevestigen", exact: true })
      .click();
    await expectPath(page, "/manager");
    await expect(
      page.getByRole("heading", { level: 1, name: "Manager", exact: true }),
    ).toBeVisible();

    await prepareLocalAuthEmployeeInvitation(lease, { store });
    await privateFill(
      page.getByLabel("E-mailadres medewerker", { exact: true }),
      lease.employee.email,
    );
    await privateFill(
      page.getByLabel("Weergavenaam (optioneel)", { exact: true }),
      lease.employee.displayName,
    );
    await privateFill(
      page.getByLabel("Medewerkerscode (optioneel)", { exact: true }),
      lease.employee.code,
    );
    markLocalAuthInvitationAttempted(lease);
    await page
      .getByRole("button", { name: "Uitnodiging versturen", exact: true })
      .click();
    await expect(
      page.getByText(
        "Als uitnodigen mogelijk is, ontvangt de medewerker een e-mail. Controleer de lokale inbox.",
      ),
    ).toBeVisible();
    await claimLocalAuthEmployee(lease, { store });

    const invitationLink = await waitForLocalEmailLink(lease.employee.email, "invite");
    // Invitations must work in a different browser: no manager PKCE verifier may be required.
    const employeeContext = await browser.newContext({
      baseURL: appOrigin,
      serviceWorkers: "block",
    });
    await blockExternalRequests(employeeContext);
    const employeePage = await employeeContext.newPage();

    try {
      await followPrivateLink(employeePage, invitationLink);
      await expectPath(employeePage, "/accept-invitation");
      await expect(
        employeePage.getByRole("heading", {
          level: 1,
          name: "Uitnodiging aanvaarden",
        }),
      ).toBeVisible();
      await privateFill(
        employeePage.getByLabel("Nieuw wachtwoord", { exact: true }),
        employeePassword,
      );
      await privateFill(
        employeePage.getByLabel("Herhaal nieuw wachtwoord", { exact: true }),
        employeePassword,
      );
      await employeePage
        .getByRole("button", { name: "Wachtwoord instellen", exact: true })
        .click();
      await expectPath(employeePage, "/employee");
      await expect(
        employeePage.getByRole("heading", {
          level: 1,
          name: "Medewerker",
          exact: true,
        }),
      ).toBeVisible();
      await verifyAcceptedLocalAuthEmployee(lease, { store });

      const authCookies = (await employeeContext.cookies()).filter(
        (cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
      );
      expect(authCookies.length > 0).toBe(true);
      expect(
        authCookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
      ).toBe(true);
      expect(
        await employeePage.evaluate(() => document.cookie.includes("auth-token")),
      ).toBe(false);

      await employeePage.goto("/manager");
      await expectPath(employeePage, "/unauthorized");
      await employeePage.goto("/employee");
      await employeePage.getByRole("button", { name: "Afmelden", exact: true }).click();
      await expectPath(employeePage, "/login");
      await employeePage.goto("/employee");
      await expectPath(employeePage, "/login");

      await login(employeePage, lease.employee.email, employeePassword);
      await expectPath(employeePage, "/employee");
      await employeePage.getByRole("button", { name: "Afmelden", exact: true }).click();
      await expectPath(employeePage, "/login");
      await employeePage.goto("/forgot-password");
      await privateFill(
        employeePage.getByLabel("E-mailadres", { exact: true }),
        lease.employee.email,
      );
      await employeePage
        .getByRole("button", { name: "Herstellink aanvragen", exact: true })
        .click();
      await expect(
        employeePage.getByText(
          "Als dit e-mailadres bij een account hoort, ontvang je een e-mail met verdere stappen.",
        ),
      ).toBeVisible();

      await followPrivateLink(
        employeePage,
        await waitForLocalEmailLink(lease.employee.email, "recovery"),
      );
      await expectPath(employeePage, "/reset-password");
      await privateFill(
        employeePage.getByLabel("Nieuw wachtwoord", { exact: true }),
        resetPassword,
      );
      await privateFill(
        employeePage.getByLabel("Herhaal nieuw wachtwoord", { exact: true }),
        resetPassword,
      );
      await employeePage
        .getByRole("button", { name: "Wachtwoord opslaan", exact: true })
        .click();
      await expectPath(employeePage, "/employee");
      await employeePage.getByRole("button", { name: "Afmelden", exact: true }).click();
      await expectPath(employeePage, "/login");
      await login(employeePage, lease.employee.email, resetPassword);
      await expectPath(employeePage, "/employee");
    } finally {
      await employeeContext.close();
      await page.context().clearCookies();
    }
  });
});

test("publieke Auth API kan geen account aanmaken", async () => {
  const response = await fetch(new URL("/auth/v1/signup", supabaseOrigin), {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `unsolicited.${randomUUID()}@example.test`,
      password: employeePassword,
    }),
    redirect: "error",
  });
  const body = (await response.json()) as Record<string, unknown>;

  expect(response.ok).toBe(false);
  expect([400, 403, 422]).toContain(response.status);
  expect(Boolean(body.access_token || body.id || body.user)).toBe(false);
});

test("aanmeldfouten onthullen geen accountbestaan", async ({ page }) => {
  await withDisposableManager(async ({ lease }) => {
    await login(page, lease.manager.email, `${employeePassword}-incorrect`);
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    const existingAccountMessage = await alert.textContent();
    await login(
      page,
      `missing.${randomUUID()}@example.test`,
      `${employeePassword}-incorrect`,
    );
    await expect(alert).toBeVisible();
    expect(await alert.textContent()).toBe(existingAccountMessage);
    await page.context().clearCookies();
  });
});

test("browserbundels bevatten geen serversleutel", async ({ page }) => {
  expect((await checkBrowserBundles(process.env.SUPABASE_SECRET_KEY)) > 0).toBe(true);
  await page.goto("/login");
  const sources = await page
    .locator("script[src]")
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).src),
    );
  expect(sources.length > 0).toBe(true);

  for (const source of sources) {
    const url = new URL(source);
    expect(url.origin).toBe(appOrigin);
    const response = await fetch(url, { redirect: "error" });
    expect(response.ok).toBe(true);
    expect(
      containsServerSecret(await response.text(), process.env.SUPABASE_SECRET_KEY),
    ).toBe(false);
  }
});
