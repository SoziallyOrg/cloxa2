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
function minuteInput(instant: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

async function exactVisibleTexts(locator: Locator) {
  const values: string[] = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    values.push(await locator.nth(index).innerText());
  }
  return values;
}

async function expectExactVisibleTexts(locator: Locator, expected: string[]) {
  expect(await locator.count()).toBe(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(await locator.nth(index).innerText()).toBe(value);
  }
}

async function exactAttributes(locator: Locator, name: string) {
  const values: Array<string | null> = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    values.push(await locator.nth(index).getAttribute(name));
  }
  return values;
}

async function expectExactAttributes(
  locator: Locator,
  name: string,
  expected: Array<string | null>,
) {
  expect(await locator.count()).toBe(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(await locator.nth(index).getAttribute(name)).toBe(value);
  }
}

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

test("begrensde native workspace UX", async ({ page: manager, browser }) => {
  test.setTimeout(90_000);
  const started = Date.now();
  await withDisposableManager(async ({ lease, store }) => {
    // Reuse the reviewed lease and cleanup. No direct business-row manufacturing.
    const settings = await fixtureSettingsPromise!;
    const readFacts = async () => {
      const facts = await runOperatorSqlAsync(
        `begin read only; set local statement_timeout='5s'; set local lock_timeout='1s';
select jsonb_build_object(
 'entries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'startedAt',started_at,'endedAt',ended_at) order by started_at) from public.time_entries where organization_id='${lease.organization.id}'::uuid),'[]'::jsonb),
 'breaks',coalesce((select jsonb_agg(jsonb_build_object('startedAt',started_at,'endedAt',ended_at) order by started_at) from public.time_breaks where organization_id='${lease.organization.id}'::uuid),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'end',proposed_ended_at) order by created_at) from public.correction_requests where organization_id='${lease.organization.id}'::uuid),'[]'::jsonb),
 'clockRequests',(select count(*) from private.time_clock_requests c join public.memberships m on m.id=c.membership_id where m.organization_id='${lease.organization.id}'::uuid)
); rollback;`,
        {
          dockerEndpoint: settings.dockerEndpoint,
          environment: settings.dockerEnvironment,
          timeoutMs: localAuthFixtureDeadlines.sqlMs,
        },
      );
      return facts as {
        entries: { id: string; startedAt: string; endedAt: string | null }[];
        breaks: { startedAt: string; endedAt: string | null }[];
        requests: { id: string; status: string; end: string }[];
        clockRequests: number;
      };
    };
    await login(manager, lease.manager.email, employeePassword);
    await expectPath(manager, "/manager/security/setup");
    await manager
      .getByRole("button", { name: "Authenticator instellen", exact: true })
      .click();
    const secret = (await manager.locator("code").textContent())?.trim();
    if (!secret) throw new Error("Run-owned manager setup unavailable.");
    await privateFill(
      manager.getByLabel("Authenticatorcode", { exact: true }),
      currentTotp(secret),
    );
    await manager
      .getByRole("button", { name: "Instelling bevestigen", exact: true })
      .click();
    await expectPath(manager, "/manager");
    await prepareLocalAuthEmployeeInvitation(lease, { store });
    await privateFill(
      manager.getByLabel("E-mailadres medewerker", { exact: true }),
      lease.employee.email,
    );
    await privateFill(
      manager.getByLabel("Weergavenaam (optioneel)", { exact: true }),
      lease.employee.displayName,
    );
    await privateFill(
      manager.getByLabel("Medewerkerscode (optioneel)", { exact: true }),
      lease.employee.code,
    );
    markLocalAuthInvitationAttempted(lease);
    await manager
      .getByRole("button", { name: "Uitnodiging versturen", exact: true })
      .click();
    await expect(
      manager.getByText(
        "Als uitnodigen mogelijk is, ontvangt de medewerker een e-mail. Controleer de lokale inbox.",
      ),
    ).toBeVisible();
    await claimLocalAuthEmployee(lease, { store });
    const invitation = await waitForLocalEmailLink(lease.employee.email, "invite");
    const context = await browser.newContext({
      baseURL: appOrigin,
      serviceWorkers: "block",
      viewport: { width: 1440, height: 900 },
    });
    await blockExternalRequests(context);
    const employee = await context.newPage();
    try {
      // Anonymous and wrong-role new routes, without borrowing retained sessions.
      for (const path of [
        "/employee/registrations",
        "/employee/requests",
        "/manager/more",
      ]) {
        await employee.goto(path);
        await expectPath(employee, "/login");
      }
      await manager.goto("/employee/registrations");
      await expectPath(manager, "/unauthorized");
      await manager.goto("/manager");
      await followPrivateLink(employee, invitation);
      await expectPath(employee, "/accept-invitation");
      await privateFill(
        employee.getByLabel("Nieuw wachtwoord", { exact: true }),
        employeePassword,
      );
      await privateFill(
        employee.getByLabel("Herhaal nieuw wachtwoord", { exact: true }),
        employeePassword,
      );
      await employee
        .getByRole("button", { name: "Wachtwoord instellen", exact: true })
        .click();
      await expectPath(employee, "/employee");
      await verifyAcceptedLocalAuthEmployee(lease, { store });
      const header = employee.locator(".clock-controls-header");
      const status = employee.getByLabel("Huidige werkstatus");
      await expect(
        header.getByRole("button", { name: "Start werk", exact: true }),
      ).toBeEnabled();
      console.log(
        "NATIVE UX: disposable invitation, manager MFA and anonymous/role guards passed.",
      );
      let held = 0;
      await employee.route("**/*", async (route) => {
        // Test-only request boundary; production deadlines and action payload unchanged.
        if (
          route.request().method() === "POST" &&
          route.request().postData()?.includes("clock_in")
        ) {
          held++;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        await route.fallback();
      });
      await header
        .getByRole("button", { name: "Start werk", exact: true })
        .evaluate((element) => {
          (element as HTMLButtonElement).click();
          (element as HTMLButtonElement).click();
        });
      await expect(
        header.getByRole("button", { name: "Start werk — bezig…", exact: true }),
      ).toBeDisabled();
      for (const button of await employee.locator(".clock-controls button").all())
        await expect(button).toBeDisabled();
      await expect(status).toContainText("Aan het werk");
      await expect(employee.locator(".clock-feedback[role=status]")).toHaveCount(1);
      await expect(header.locator(".clock-feedback")).toBeFocused();
      const first = await readFacts();
      expect(first.entries.length).toBe(1);
      expect(first.entries[0]!.endedAt).toBeNull();
      expect(first.clockRequests).toBe(1);
      expect(held).toBe(1);
      const navigate = async (name: string, path: string) => {
        const before = await employee.locator(".workspace-header").boundingBox();
        await employee.evaluate(() => {
          const bag = window as unknown as {
            uxLoading: boolean;
            uxObserver: MutationObserver;
          };
          bag.uxLoading = false;
          bag.uxObserver = new MutationObserver(() => {
            if (
              document
                .querySelector(".workspace-work-status")
                ?.textContent?.includes("wordt gecontroleerd")
            )
              bag.uxLoading = true;
          });
          bag.uxObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        });
        await employee
          .getByRole("navigation", { name: "Medewerkernavigatie" })
          .getByRole("link", { name, exact: true })
          .click();
        await expectPath(employee, path);
        await expect(status).toContainText("Aan het werk");
        const after = await employee.locator(".workspace-header").boundingBox();
        expect(after!.height).toBe(before!.height);
        expect(
          await employee.evaluate(() => {
            const bag = window as unknown as {
              uxLoading: boolean;
              uxObserver: MutationObserver;
            };
            bag.uxObserver.disconnect();
            return bag.uxLoading;
          }),
        ).toBe(false);
        await expect(employee.locator(".clock-feedback[role]")).toHaveCount(0);
      };
      await navigate("Registraties", "/employee/registrations");
      await navigate("Aanvragen", "/employee/requests");
      await employee.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        header.getByRole("button", { name: "Start pauze", exact: true }),
      ).toBeEnabled();
      await header.getByRole("button", { name: "Start pauze", exact: true }).click();
      await expect(status).toContainText("Met pauze");
      expect((await readFacts()).breaks.filter((b) => b.endedAt === null).length).toBe(
        1,
      );
      await expect(header.getByRole("button")).toHaveCount(1);
      await header
        .getByRole("button", { name: "Pauze beëindigen", exact: true })
        .click();
      await expect(status).toContainText("Aan het werk");
      expect((await readFacts()).breaks.filter((b) => b.endedAt === null).length).toBe(
        0,
      );
      await header.getByRole("button", { name: "Start pauze", exact: true }).click();
      await expect(status).toContainText("Met pauze");
      await header
        .getByRole("button", { name: "Pauze beëindigen", exact: true })
        .click();
      await expect(status).toContainText("Aan het werk");
      await header.getByRole("button", { name: "Stop werk", exact: true }).click();
      await expect(
        header.getByRole("button", { name: "Start werk", exact: true }),
      ).toBeEnabled();
      const completed = await readFacts();
      expect(completed.entries[0]!.endedAt).not.toBeNull();
      expect(completed.breaks.length).toBe(2);
      console.log(
        "NATIVE UX: real Next links, single clock-in request, coordinated controls, two breaks and clock-out passed.",
      );
      await employee
        .getByRole("navigation", { name: "Medewerkernavigatie" })
        .getByRole("link", { name: "Registraties", exact: true })
        .click();
      const record = employee.getByTestId("closed-entries");
      await expect(record.locator(".registration-record")).toHaveCount(1);
      await expect(record.locator(".record-totals")).toContainText("Bruto");
      await expect(record.locator(".record-totals")).toContainText("Pauze");
      await expect(record.locator(".record-totals")).toContainText("Netto");
      const totalLabels = await exactVisibleTexts(record.locator(".record-totals dt"));
      const totalValues = await exactVisibleTexts(record.locator(".record-totals dd"));
      await record.getByText("Details van registratie", { exact: true }).click();
      const exactLabels = await exactVisibleTexts(record.locator(".record-exact dt"));
      const exactValues = await exactVisibleTexts(record.locator(".record-exact dd"));
      const exactTimes = record.locator(".record-details time");
      const exactTimeTexts = await exactVisibleTexts(exactTimes);
      const exactTimeValues = await exactAttributes(exactTimes, "datetime");
      const breakItems = record.locator(".record-details ol > li");
      const breakDetails: Array<{
        lines: string[];
        timeTexts: string[];
        timeValues: Array<string | null>;
      }> = [];
      for (let index = 0; index < (await breakItems.count()); index += 1) {
        const item = breakItems.nth(index);
        const times = item.locator("time");
        breakDetails.push({
          lines: await exactVisibleTexts(item.locator(":scope > p")),
          timeTexts: await exactVisibleTexts(times),
          timeValues: await exactAttributes(times, "datetime"),
        });
      }
      await employee.setViewportSize({ width: 390, height: 844 });
      await expectExactVisibleTexts(record.locator(".record-totals dt"), totalLabels);
      await expectExactVisibleTexts(record.locator(".record-totals dd"), totalValues);
      await expectExactVisibleTexts(record.locator(".record-exact dt"), exactLabels);
      await expectExactVisibleTexts(record.locator(".record-exact dd"), exactValues);
      await expectExactVisibleTexts(exactTimes, exactTimeTexts);
      await expectExactAttributes(exactTimes, "datetime", exactTimeValues);
      expect(await breakItems.count()).toBe(breakDetails.length);
      for (const [index, expectedBreak] of breakDetails.entries()) {
        const item = breakItems.nth(index);
        const times = item.locator("time");
        await expectExactVisibleTexts(item.locator(":scope > p"), expectedBreak.lines);
        await expectExactVisibleTexts(times, expectedBreak.timeTexts);
        await expectExactAttributes(times, "datetime", expectedBreak.timeValues);
      }
      expect(
        await employee.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await employee.setViewportSize({ width: 1440, height: 900 });
      await record
        .getByRole("button", { name: "Correctie aanvragen", exact: true })
        .click();
      await employee
        .locator('input[name="proposed_start_local"]')
        .fill(
          minuteInput(
            new Date(
              Date.parse(completed.entries[0]!.startedAt) - 60_000,
            ).toISOString(),
          ),
        );
      await employee
        .getByLabel("Reden", { exact: true })
        .fill("Fictieve native UX-controle: alleen start wijzigen.");
      await employee
        .getByRole("button", { name: "Aanvraag indienen", exact: true })
        .click();
      await expect.poll(async () => (await readFacts()).requests.length).toBe(1);
      const request = (await readFacts()).requests[0]!;
      expect(request.end).toBe(completed.entries[0]!.endedAt);
      await employee
        .getByRole("navigation", { name: "Medewerkernavigatie" })
        .getByRole("link", { name: "Aanvragen", exact: true })
        .click();
      await expect(
        employee.getByText("Fictieve native UX-controle: alleen start wijzigen."),
      ).toBeVisible();
      await manager.goto("/manager/corrections");
      await manager.getByRole("button", { name: "Goedkeuren", exact: true }).click();
      await manager
        .getByRole("button", { name: "Goedkeuren en toepassen", exact: true })
        .click();
      await expect
        .poll(async () => (await readFacts()).requests[0]!.status)
        .toBe("approved");
      await employee
        .getByRole("navigation", { name: "Medewerkernavigatie" })
        .getByRole("link", { name: "Registraties", exact: true })
        .click();
      await employee.reload();
      await expect(record).toContainText("Gecorrigeerd");
      await employee.goto(`/employee/registrations#decision-${request.id}`);
      await expect(employee.locator(`#decision-${request.id}`)).toHaveAttribute(
        "open",
        "",
      );
      expect((await readFacts()).entries[0]!.endedAt).toBe(
        completed.entries[0]!.endedAt,
      );
      await employee.goto("/manager/more");
      await expectPath(employee, "/unauthorized");
      await employee.goto("/employee");
      await employee.locator(".workspace-account summary").click();
      await employee.getByRole("button", { name: "Afmelden", exact: true }).click();
      await expectPath(employee, "/login");
      await expect(employee.locator(".workspace-work-status")).toHaveCount(0);
      console.log(
        "NATIVE UX: compact/exact registrations, unchanged endpoint precision, approved decision permalink and logout passed.",
      );
    } finally {
      await context.close();
      await manager.context().close();
    }
  });
  console.log(
    `NATIVE UX: owned lease cleanup confirmed; duration ${Date.now() - started}ms. Native refusal/late-scope race not independently induced; covered service-free.`,
  );
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
