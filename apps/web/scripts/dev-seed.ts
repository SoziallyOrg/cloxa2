/**
 * Local demo data: one fictional organization with two sites, an owner, a
 * manager and four employees. Run with `pnpm --filter @cloxa/web dev:seed`
 * after `pnpm db:start`. Safe to run again: existing rows are reused.
 *
 * Accounts (fictional, `.test` domain, no passwords; log in with an email code):
 *   eigenaar@demo.test (owner) · manager@demo.test (manager, both sites)
 *   manager-e2e@demo.test (manager, site 1; reserved for the e2e tests)
 *   jan@demo.test, els@demo.test (site 1) · mohamed@demo.test, lotte@demo.test (site 2)
 *   schedule-e2e@demo.test (site 1; reserved for the schedule e2e test)
 *   kiosk-admin@demo.test (admin), kiosk-e2e@demo.test (site 1; reserved for the kiosk e2e)
 *   offline-e2e@demo.test (site 1; reserved for the offline e2e)
 *   offboard-e2e@demo.test (site 1; reserved for the offboarding e2e)
 *   journey-e2e@demo.test (site 1; reserved for manager-journey.spec.ts)
 *   owner-e2e@demo.test (owner, site 1; reserved for e2e specs needing owner
 *     rights, so eigenaar@demo.test's session is never disturbed)
 *   screens-geen@demo.test (no membership) and screens-twee@demo.test (two
 *     organizations): the access screens in `pnpm screens`
 *   screens-beheer@demo.test (owner of "Bakkerij Zon (fictief)", its own
 *     organization with two sites, a team of nine with screens-team-*@
 *     logins, requests, kiosks and exports) and screens-beheer-leeg@demo.test
 *     (owner of an empty organization): the manager screens in `pnpm screens`
 *   modules-owner-e2e@demo.test (owner of "Modules Test (fictief)") and
 *     modules-e2e@demo.test (its student): reserved for modules.spec.ts
 *   screens-modules@demo.test (owner of "Kantoor Verbeke (fictief)", four
 *     modules on) with screens-modules-student@ and screens-modules-interim@:
 *     the module screens in `pnpm screens`
 *   screens-e2e@, screens-pauze@, screens-uit@, screens-actie@,
 *     screens-leeg@demo.test (site 1; reserved for `pnpm screens`: made-up
 *     history and a realistic "today", reset on every run; screens-leeg@ has
 *     no data at all; see seedScreens)
 * Codes arrive in the local Mailpit: http://127.0.0.1:54324
 *
 * Refuses to run unless both the Supabase API and the database are on
 * loopback. Uses the secret key (admin API, service_role RPCs) and, for the
 * invitations, a short-lived session for a dedicated `seed-owner@demo.test`
 * account with a throwaway TOTP factor, because `rpc_invite_member` requires
 * fresh MFA like any real inviter. This account (and only this account) has
 * its MFA factors reset on every run: the human demo accounts
 * (eigenaar@, manager@, jan@, els@, mohamed@, lotte@demo.test) are never
 * touched, so a tester's manual session at /manage survives a reseed.
 * There is no site RPC yet, so the second site and the seed-owner membership
 * are inserted with SQL.
 *
 * Runs on Node's built-in TypeScript support: erasable syntax only, and
 * type-only imports from workspace packages.
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { Sql as PgSql, TransactionSql } from "postgres";

import type { Database } from "@cloxa/db";

type Client = SupabaseClient<Database>;
type Role = "admin" | "manager" | "employee";
type SiteKey = "main" | "second";

const ORG_NAME = "Bakkerij Demo (fictief)";
const SECOND_SITE_NAME = "Filiaal Markt (fictief)";
const OWNER = { email: "eigenaar@demo.test", name: "Olivia Eigenaar" };
// Seed-only account used to call rpc_invite_member: never a human's account,
// so its MFA factor can be reset on every run without breaking a manual
// session. Not part of MEMBERS: it is given a membership directly, below.
const SEED_OWNER = { email: "seed-owner@demo.test", name: "Seed Owner (intern)" };
// A second, dedicated owner for e2e specs that need owner rights (audit log,
// offboarding): also never a human's account, so its factors can be reset
// freely. Given a membership and employee row directly, like SEED_OWNER.
const OWNER_E2E = { email: "owner-e2e@demo.test", name: "Owen Testeigenaar" };
// `pnpm screens` of the two access screens: signed in without any membership
// (geen-toegang), and working for two organizations (kies-organisatie). The
// second organization is fictional too, with a long name (truncation).
const SCREENS_NO_ACCESS = "screens-geen@demo.test";
const SCREENS_TWO_ORGS = { email: "screens-twee@demo.test", name: "Ines Wouters" };
const SECOND_ORG_NAME = "Brasserie Het Groene Pleintje aan de Oude Vismarkt (fictief)";
// `pnpm screens` (design screenshots). The screenshots show the first three,
// which a run never clocks with; live clock actions (the confirmation) use the
// last one. `today` is what each shows today; see settleScreensToday.
const SCREENS_ACCOUNTS = [
  {
    email: "screens-e2e@demo.test",
    name: "Sanne Peeters",
    today: "working",
    history: true,
    schedule: true,
  },
  {
    email: "screens-pauze@demo.test",
    name: "Bram Maes",
    today: "on_break",
    history: false,
    schedule: true,
  },
  {
    email: "screens-uit@demo.test",
    name: "Chiara Vos",
    today: "off",
    history: false,
    schedule: true,
  },
  {
    email: "screens-actie@demo.test",
    name: "Driss Aerts",
    today: null,
    history: false,
    schedule: true,
  },
  // A fresh start: no hours, no questions, no schedule (the empty states),
  // and a long name (truncation).
  {
    email: "screens-leeg@demo.test",
    name: "Maximiliaan Van den Broeck-Vercruysse",
    today: "off",
    history: false,
    schedule: false,
  },
] as const;
const MEMBERS: readonly {
  email: string;
  name: string;
  role: Role;
  sites: readonly SiteKey[];
}[] = [
  {
    email: "manager@demo.test",
    name: "Marc Manager",
    role: "manager",
    sites: ["main", "second"],
  },
  // Dedicated to the manager e2e, which resets its TOTP factors on every run.
  {
    email: "manager-e2e@demo.test",
    name: "Mia Testmanager",
    role: "manager",
    sites: ["main"],
  },
  { email: "jan@demo.test", name: "Jan Janssens", role: "employee", sites: ["main"] },
  { email: "els@demo.test", name: "Els Maes", role: "employee", sites: ["main"] },
  // Dedicated to the kiosk e2e: an admin who creates kiosks (TOTP reset per run)
  // and an employee who clocks only through the kiosk.
  {
    email: "kiosk-admin@demo.test",
    name: "Kim Kioskbeheer",
    role: "admin",
    sites: ["main"],
  },
  {
    email: "kiosk-e2e@demo.test",
    name: "Karel Kiosktest",
    role: "employee",
    sites: ["main"],
  },
  // Dedicated to the schedule e2e spec.
  {
    email: "schedule-e2e@demo.test",
    name: "Sam Testrooster",
    role: "employee",
    sites: ["main"],
  },
  // Dedicated to the offline clocking e2e spec.
  {
    email: "offline-e2e@demo.test",
    name: "Olaf Offlinetest",
    role: "employee",
    sites: ["main"],
  },
  // Dedicated to the offboarding e2e spec (offboarded and reinstated per run).
  {
    email: "offboard-e2e@demo.test",
    name: "Otto Uitdiensttest",
    role: "employee",
    sites: ["main"],
  },
  // Dedicated to manager-journey.spec.ts (a "forgot to clock in" correction
  // is appended to this account's history, so it can't be shared).
  {
    email: "journey-e2e@demo.test",
    name: "Jef Journeytest",
    role: "employee",
    sites: ["main"],
  },
  // Dedicated to `pnpm screens` (design screenshots).
  ...SCREENS_ACCOUNTS.map((account) => ({
    email: account.email,
    name: account.name,
    role: "employee" as const,
    sites: ["main" as const],
  })),
  {
    email: "mohamed@demo.test",
    name: "Mohamed El Amrani",
    role: "employee",
    sites: ["second"],
  },
  {
    email: "lotte@demo.test",
    name: "Lotte Claes",
    role: "employee",
    sites: ["second"],
  },
];

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

let status: Record<string, unknown> | null = null;
function localStatus(key: string): string | undefined {
  status ??= JSON.parse(
    execSync("supabase status -o json", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Record<string, unknown>;
  const value = status[key];
  return typeof value === "string" ? value : undefined;
}

function setting(envName: string, statusKey: string): string {
  const value = process.env[envName] || localStatus(statusKey);
  if (!value)
    throw new Error(
      `${envName} is not set and \`supabase status\` has no ${statusKey}.`,
    );
  return value;
}

function isLoopback(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), only for the throwaway seed factor.
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

function fail(
  step: string,
  error: { message: string; code?: string | undefined } | null,
): never {
  throw new Error(
    `${step} failed: ${error?.code ?? ""} ${error?.message ?? "no data"}`.trim(),
  );
}

async function main(): Promise<void> {
  const url = setting("NEXT_PUBLIC_SUPABASE_URL", "API_URL");
  const dbUrl = setting("SUPABASE_DB_URL", "DB_URL");
  if (!isLoopback(url) || !isLoopback(dbUrl)) {
    throw new Error(
      "Refusing to seed: Supabase URL and database must be on loopback (local only).",
    );
  }
  const secretKey = setting("SUPABASE_SECRET_KEY", "SECRET_KEY");
  const publishableKey = setting(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "PUBLISHABLE_KEY",
  );

  const noSession = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };
  const admin: Client = createClient<Database>(url, secretKey, { auth: noSession });

  // Users ---------------------------------------------------------------------------------
  const userIds = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("listUsers", error);
    for (const user of data.users)
      if (user.email) userIds.set(user.email.toLowerCase(), user.id);
    if (data.users.length < 1000) break;
  }

  async function ensureUser(email: string): Promise<string> {
    const existing = userIds.get(email);
    if (existing) return existing;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) fail("createUser", error);
    userIds.set(email, data.user.id);
    return data.user.id;
  }

  const ownerId = await ensureUser(OWNER.email);

  // Organization and sites --------------------------------------------------------------
  const { data: ownerships, error: ownershipError } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", ownerId)
    .eq("role", "owner");
  if (ownershipError) fail("memberships", ownershipError);

  let organizationId: string | null = null;
  if (ownerships.length > 0) {
    const { data: orgs, error } = await admin
      .from("organizations")
      .select("id")
      .eq("name", ORG_NAME)
      .in(
        "id",
        ownerships.map((row) => row.organization_id),
      );
    if (error) fail("organizations", error);
    organizationId = orgs[0]?.id ?? null;
  }

  if (!organizationId) {
    const { data, error } = await admin.rpc("rpc_admin_create_organization", {
      p_name: ORG_NAME,
      p_owner_user_id: ownerId,
      p_owner_display_name: OWNER.name,
    });
    if (error || !data[0]) fail("rpc_admin_create_organization", error);
    organizationId = data[0].organization_id;
  }
  const orgId = organizationId;

  const { data: sites, error: sitesError } = await admin
    .from("sites")
    .select("id, name, created_at")
    .eq("organization_id", orgId)
    .order("created_at");
  if (sitesError) fail("sites", sitesError);

  const mainSite = sites.find((site) => site.name !== SECOND_SITE_NAME);
  if (!mainSite) throw new Error("The demo organization has no default site.");
  let secondSiteId = sites.find((site) => site.name === SECOND_SITE_NAME)?.id;
  if (!secondSiteId) {
    const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined });
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into public.sites (organization_id, name)
        values (${orgId}, ${SECOND_SITE_NAME})
        returning id`;
      secondSiteId = row!.id;
    } finally {
      await sql.end();
    }
  }
  const siteIds: Record<SiteKey, string> = { main: mainSite.id, second: secondSiteId };

  // Seed-only inviter -----------------------------------------------------------------------
  // A dedicated admin membership so invitations never require resetting the
  // MFA of a human demo account (eigenaar@demo.test's factor is left alone).
  const seedOwnerId = await ensureUser(SEED_OWNER.email);
  const ownerE2eId = await ensureUser(OWNER_E2E.email);
  await ensureUser(SCREENS_NO_ACCESS);
  const twoOrgsId = await ensureUser(SCREENS_TWO_ORGS.email);
  {
    const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined });
    try {
      await sql`
        insert into public.memberships (organization_id, user_id, role, status)
        values (${orgId}, ${seedOwnerId}, 'admin', 'active')
        on conflict (organization_id, user_id) do nothing`;

      const [ownerMembership] = await sql<{ id: string }[]>`
        insert into public.memberships (organization_id, user_id, role, status)
        values (${orgId}, ${ownerE2eId}, 'owner', 'active')
        on conflict (organization_id, user_id) do update set role = excluded.role
        returning id`;
      const [ownerEmployee] = await sql<{ id: string }[]>`
        insert into public.employees (organization_id, user_id, display_name)
        values (${orgId}, ${ownerE2eId}, ${OWNER_E2E.name})
        on conflict (organization_id, user_id) do update set display_name = excluded.display_name
        returning id`;
      if (ownerMembership && ownerEmployee) {
        await sql`
          insert into public.site_assignments (organization_id, site_id, employee_id)
          values (${orgId}, ${siteIds.main}, ${ownerEmployee.id})
          on conflict (organization_id, site_id, employee_id) do nothing`;
      }

      // screens-twee@: an employee here, and the owner of a second organization.
      const [twoOrgsMembership] = await sql<{ id: string }[]>`
        insert into public.memberships (organization_id, user_id, role, status)
        values (${orgId}, ${twoOrgsId}, 'employee', 'active')
        on conflict (organization_id, user_id) do update set status = 'active'
        returning id`;
      const [twoOrgsEmployee] = await sql<{ id: string }[]>`
        insert into public.employees (organization_id, user_id, display_name)
        values (${orgId}, ${twoOrgsId}, ${SCREENS_TWO_ORGS.name})
        on conflict (organization_id, user_id) do update set display_name = excluded.display_name
        returning id`;
      if (twoOrgsMembership && twoOrgsEmployee) {
        await sql`
          insert into public.site_assignments (organization_id, site_id, employee_id)
          values (${orgId}, ${siteIds.main}, ${twoOrgsEmployee.id})
          on conflict (organization_id, site_id, employee_id) do nothing`;
      }
      const [secondOrg] = await sql`
        select 1 from public.memberships m
        join public.organizations o on o.id = m.organization_id
        where m.user_id = ${twoOrgsId} and o.name = ${SECOND_ORG_NAME} limit 1`;
      if (!secondOrg) {
        const { error } = await admin.rpc("rpc_admin_create_organization", {
          p_name: SECOND_ORG_NAME,
          p_owner_user_id: twoOrgsId,
          p_owner_display_name: SCREENS_TWO_ORGS.name,
        });
        if (error) fail("rpc_admin_create_organization", error);
      }
    } finally {
      await sql.end();
    }
  }

  // Members -------------------------------------------------------------------------------
  let owner: { client: Client; factorId: string } | null = null;

  /**
   * A short-lived aal2 session for a seed-only account (never a human's).
   * Enrolling at aal1 is refused once a verified factor exists, so its
   * factors are reset first; the caller deletes the throwaway factor after.
   */
  async function privilegedSession(
    email: string,
    userId: string,
  ): Promise<{ client: Client; factorId: string }> {
    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId,
    });
    if (listError) fail("admin.mfa.listFactors", listError);
    for (const factor of factors.factors) {
      await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) fail("generateLink", linkError);

    const client: Client = createClient<Database>(url, publishableKey, {
      auth: noSession,
    });
    const { error: otpError } = await client.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    });
    if (otpError) fail("verifyOtp", otpError);

    const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "dev-seed",
    });
    if (enrollError) fail("mfa.enroll", enrollError);
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: totp(enrolled.totp.secret),
    });
    if (verifyError) fail("mfa.challengeAndVerify", verifyError);

    return { client, factorId: enrolled.id };
  }

  const privilegedOwner = () => privilegedSession(SEED_OWNER.email, seedOwnerId);

  /** A plain (aal1) session, e.g. to accept an invitation like a first login. */
  async function signIn(email: string): Promise<Client> {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) fail("generateLink", linkError);
    const client: Client = createClient<Database>(url, publishableKey, {
      auth: noSession,
    });
    const { error } = await client.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    });
    if (error) fail("verifyOtp", error);
    return client;
  }

  let created = 0;
  try {
    for (const member of MEMBERS) {
      const userId = await ensureUser(member.email);

      const { data: membership, error: membershipError } = await admin
        .from("memberships")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) fail("memberships", membershipError);
      if (membership) continue;

      const { data: invitation, error: invitationError } = await admin
        .from("invitations")
        .select("id")
        .eq("organization_id", orgId)
        .eq("email", member.email)
        .in("status", ["pending", "linked"])
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (invitationError) fail("invitations", invitationError);

      let invitationId = invitation?.id;
      if (!invitationId) {
        owner ??= await privilegedOwner();
        const { data, error } = await owner.client.rpc("rpc_invite_member", {
          p_org: orgId,
          p_email: member.email,
          p_role: member.role,
          p_display_name: member.name,
          p_site_ids: member.sites.map((site) => siteIds[site]),
        });
        if (error) fail("rpc_invite_member", error);
        invitationId = data;
      }

      // Membership stays `invited` until the first login accepts it.
      const { error: linkError } = await admin.rpc("rpc_link_invited_user", {
        p_invitation_id: invitationId,
        p_user_id: userId,
      });
      if (linkError) fail("rpc_link_invited_user", linkError);
      created += 1;
    }
  } finally {
    if (owner) {
      await admin.auth.admin.mfa.deleteFactor({
        id: owner.factorId,
        userId: seedOwnerId,
      });
      await owner.client.auth.signOut({ scope: "local" });
    }
  }

  await seedScreens({
    dbUrl,
    orgId,
    siteId: siteIds.main,
    deciderId: ownerId,
    userIds,
  });

  await seedManagerScreens({
    dbUrl,
    admin,
    ensureUser,
    privilegedSession,
    signIn,
    requesterId: seedOwnerId,
  });

  await seedModules({ dbUrl, admin, ensureUser, privilegedSession, signIn });

  console.log(
    `Demo organization ready: 2 sites, ${MEMBERS.length + 1} accounts (${created} newly linked).`,
  );
  console.log(
    "Log in at /login with an address listed in apps/web/scripts/dev-seed.ts.",
  );
  console.log("Codes arrive in Mailpit: http://127.0.0.1:54324");
}

// Screens accounts -----------------------------------------------------------------------

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Brussels",
  weekday: "short",
});
const HOUR_MINUTE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A Brussels wall-clock time (minutes after midnight) on a Brussels day, DST included. */
function brussels(dayKey: string, minutes: number): Date {
  const [y = 0, m = 1, d = 1] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  for (const offsetHours of [2, 1]) {
    const guess = new Date(naive - offsetHours * 3_600_000);
    const [hh = "0", mm = "0"] = HOUR_MINUTE.format(guess).split(":");
    if (Number(hh) * 60 + Number(mm) === minutes % 1440) return guess;
  }
  return new Date(naive - 3_600_000);
}

type SeedEventType = "clock_in" | "clock_out" | "break_start" | "break_end" | "void";
type Sql = PgSql;
type Tx = TransactionSql;

interface ScreensPerson {
  employeeId: string;
  userId: string;
}

interface ScreensContext {
  orgId: string;
  siteId: string;
  deciderId: string;
}

/**
 * Appends one clock event with the append trigger switched off, doing by hand
 * exactly what the trigger does (chain lock, hash, chain head) except that it
 * keeps `occurred_at`. Needs `session_replication_role = replica` in `tx`.
 *
 * Why: live clock events always get occurred_at = server time, so a made-up
 * past (history, "working since 08:02") can't be recorded through the app.
 * Local seed only; the hash chain stays valid (`verify_clock_chain`).
 */
async function appendSeedEvent(
  tx: Tx,
  context: ScreensContext,
  person: ScreensPerson,
  event: {
    type: SeedEventType;
    at: Date;
    offline?: boolean;
    supersedes?: string;
    correctionId?: string;
    /** Telework (ADR 008): only on a clock_in. */
    workLocation?: "site" | "home";
  },
): Promise<string> {
  const correction = event.type === "void" || event.supersedes !== undefined;
  const [head] = await tx<{ prev: Buffer }[]>`
    select private.chain_lock_head(${context.orgId}::uuid, 'clock_events') as prev`;
  const [row] = await tx<{ id: string }[]>`
    insert into public.clock_events (
      organization_id, site_id, employee_id, type, occurred_at, client_captured_at,
      source, supersedes_event_id, correction_id, actor_user_id, idempotency_key,
      offline, work_location, server_at, prev_hash, hash)
    values (
      ${context.orgId}, ${context.siteId}, ${person.employeeId}, ${event.type}, ${event.at},
      ${event.offline ? event.at : null}, ${correction ? "correction" : "app"},
      ${event.supersedes ?? null}, ${event.correctionId ?? null},
      ${correction ? context.deciderId : person.userId}, gen_random_uuid(),
      ${event.offline ?? false}, ${event.workLocation ?? null},
      ${event.offline ? new Date(Math.min(event.at.getTime() + 40 * MINUTE, Date.now())) : new Date()},
      ${head!.prev},
      decode(md5(random()::text) || md5(random()::text), 'hex'))
    returning id`;
  const [hashed] = await tx<{ hash: Buffer }[]>`
    update public.clock_events as event
    set hash = private.chain_hash(event.prev_hash, private.clock_event_canonical(event))
    where event.id = ${row!.id}
    returning event.hash`;
  await tx`
    select private.chain_set_head(
      ${context.orgId}::uuid, 'clock_events', ${row!.id}::uuid, ${hashed!.hash})`;
  return row!.id;
}

interface EffectiveEvent {
  id: string;
  type: Exclude<SeedEventType, "void">;
  at: Date;
}

/** Effective events (not superseded, not void), oldest first: like `effectiveEvents`. */
async function effectiveEventsOf(sql: Sql | Tx, employeeId: string) {
  const rows = await sql<
    {
      id: string;
      type: SeedEventType;
      occurred_at: Date;
      supersedes_event_id: string | null;
    }[]
  >`
    select id, type, occurred_at, supersedes_event_id from public.clock_events
    where employee_id = ${employeeId}
    order by occurred_at, id`;
  const superseded = new Set(
    rows.map((row) => row.supersedes_event_id).filter(Boolean),
  );
  return rows
    .filter((row) => row.type !== "void" && !superseded.has(row.id))
    .map(
      (row) => ({ id: row.id, type: row.type, at: row.occurred_at }) as EffectiveEvent,
    );
}

async function screensPerson(
  sql: Sql,
  orgId: string,
  email: string,
  userId: string,
): Promise<ScreensPerson> {
  const [invitation] = await sql<{ employee_id: string }[]>`
    select employee_id from public.invitations
    where organization_id = ${orgId} and email = ${email}
    order by created_at desc limit 1`;
  if (!invitation) throw new Error(`${email} has no invitation`);
  return { employeeId: invitation.employee_id, userId };
}

/**
 * A planned block that starts `ago` minutes before now (negative: later), snapped
 * down to a quarter hour and `length` minutes long. Past midnight it becomes an
 * overnight block, which the schedule rules allow.
 */
function plannedBlock(now: number, ago: number, length: number) {
  const [hh = "0", mm = "0"] = HOUR_MINUTE.format(new Date(now - ago * MINUTE)).split(
    ":",
  );
  const minutes = Number(hh) * 60 + Number(mm);
  const start = minutes - (minutes % 15);
  const end = (start + length) % 1440;
  const clock = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { start: clock(start), end: clock(end) };
}

/**
 * The same planned block every day, relative to now on every run (a fixed 08:00
 * is in the future or the past depending on the hour the screens run), so the
 * clock and the timelines look like a normal working day at any time.
 */
async function setDailySchedule(
  sql: Sql,
  orgId: string,
  employeeId: string,
  createdBy: string,
  block: { start: string; end: string },
): Promise<void> {
  const pattern = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [block]]),
  );
  const [latest] = await sql<{ id: string }[]>`
    select id from public.schedules
    where organization_id = ${orgId} and employee_id = ${employeeId}
    order by version desc limit 1`;
  if (latest) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.schedules set pattern = ${tx.json(pattern)} where id = ${latest.id}`;
    });
    return;
  }
  await sql`
    insert into public.schedules
      (organization_id, employee_id, version, valid_from, pattern, created_by, notified_at)
    values (${orgId}, ${employeeId}, 1, ${"2026-01-01"},
      ${sql.json(pattern)}, ${createdBy}, now())`;
}

/**
 * Weekday shifts over the last three weeks (one corrected, one offline) and
 * three questions. Idempotent: a day that already has events is left alone.
 */
async function seedScreensHistory(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
  options: { pendingRequest: boolean; offlineDay: boolean } = {
    pendingRequest: true,
    offlineDay: true,
  },
): Promise<void> {
  const { orgId, siteId, deciderId } = context;
  const { employeeId, userId } = person;

  const existing = await sql<{ occurred_at: Date }[]>`
    select occurred_at from public.clock_events where employee_id = ${employeeId}`;
  const busyDays = new Set(existing.map((row) => DAY_KEY.format(row.occurred_at)));

  const now = Date.now();
  const days: string[] = [];
  for (let back = 1; back <= 21; back += 1) {
    const probe = new Date(now - back * 86_400_000);
    if (["Sat", "Sun"].includes(WEEKDAY.format(probe))) continue;
    days.push(DAY_KEY.format(probe));
  }

  const toCorrect: { id: string; at: Date }[] = [];
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const [index, day] of days.entries()) {
      if (busyDays.has(day)) continue;
      const jitter = (index * 7) % 11;
      const offline = options.offlineDay && index === 1;
      const events: { type: SeedEventType; at: Date }[] = [
        { type: "clock_in", at: brussels(day, 8 * 60 - 4 + jitter) },
        { type: "break_start", at: brussels(day, 12 * 60 + jitter) },
        { type: "break_end", at: brussels(day, 12 * 60 + 30 + jitter) },
        { type: "clock_out", at: brussels(day, 16 * 60 + 25 + ((jitter * 3) % 13)) },
      ];
      for (const event of events) {
        const id = await appendSeedEvent(tx, context, person, { ...event, offline });
        if (index === 3 && event.type === "clock_out")
          toCorrect.push({ id, at: event.at });
      }
    }
  });

  const [anyRequest] = await sql`
    select 1 from public.correction_requests
    where organization_id = ${orgId} and employee_id = ${employeeId} limit 1`;
  if (anyRequest) return;

  const decidedAt = new Date(now - 2 * 86_400_000);
  const target = toCorrect[0];
  if (target) {
    const corrected = new Date(target.at.getTime() + 45 * MINUTE);
    const proposed = {
      events: [{ target_event_id: target.id, occurred_at: corrected.toISOString() }],
    };
    const [request] = await sql<{ id: string }[]>`
      insert into public.correction_requests (
        organization_id, employee_id, requested_by, kind, target_event_ids,
        proposed, reason, status, decided_by, decided_at, created_at)
      values (
        ${orgId}, ${employeeId}, ${userId}, 'adjust', ${sql.array([target.id])}::uuid[],
        ${sql.json(proposed)}, 'Ik ben later gestopt: de levering kwam laat.',
        'approved', ${deciderId}, ${decidedAt},
        ${new Date(decidedAt.getTime() - HOUR)})
      returning id`;
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await appendSeedEvent(tx, context, person, {
        type: "clock_out",
        at: corrected,
        supersedes: target.id,
        correctionId: request!.id,
      });
    });
  }

  const rejected = {
    events: [
      {
        type: "clock_in",
        occurred_at: brussels(days[6] ?? days[0]!, 7 * 60 + 30).toISOString(),
        site_id: siteId,
      },
    ],
  };
  await sql`
    insert into public.correction_requests (
      organization_id, employee_id, requested_by, kind, proposed, reason, status,
      decided_by, decided_at, decision_note, created_at)
    values (
      ${orgId}, ${employeeId}, ${userId}, 'add', ${sql.json(rejected)},
      'Ik begon vroeger voor de inventaris.', 'rejected', ${deciderId}, ${decidedAt},
      'Die dag begon je om 08:00, zoals gepland.',
      ${new Date(decidedAt.getTime() - 2 * HOUR)})`;

  if (!options.pendingRequest) return;
  const pending = {
    events: [
      {
        type: "break_start",
        occurred_at: brussels(days[0]!, 12 * 60).toISOString(),
        site_id: siteId,
      },
    ],
  };
  await sql`
    insert into public.correction_requests (
      organization_id, employee_id, requested_by, kind, proposed, reason)
    values (
      ${orgId}, ${employeeId}, ${userId}, 'add', ${sql.json(pending)},
      'Ik vergat mijn pauze te klokken.')`;
}

/** What a screens account shows today: `null` leaves today alone (live actions). */
type TodayState = "working" | "on_break" | "off" | null;

/**
 * Brings a screens account to a realistic "today", on every run:
 * Everything is relative to now, never to a clock time: just after midnight the
 * events land on yesterday evening (an overnight shift) and still look normal.
 * - a shift left open from before the last six hours is closed about 8.5 hours
 *   after it began;
 * - `working`: one clock-in 3 h 30 min ago;
 * - `on_break`: a clock-in 4 h ago and a break since 18 minutes;
 * - `off`: nothing in the last six hours.
 * Recent events that don't fit are voided (the standard "remove" correction),
 * so reruns never pile up short shifts.
 */
async function settleScreensToday(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
  state: TodayState,
): Promise<void> {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const cutoff = now - 6 * HOUR;

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const events = await effectiveEventsOf(tx, person.employeeId);

    // Close a shift left open before the window.
    const before = events.filter((event) => event.at.getTime() < cutoff);
    let shiftStart: number | null = null;
    let breakStart: number | null = null;
    for (const event of before) {
      if (event.type === "clock_in") shiftStart = event.at.getTime();
      if (event.type === "clock_out") shiftStart = null;
      if (event.type === "break_start") breakStart = event.at.getTime();
      if (event.type === "break_end" || event.type === "clock_out") breakStart = null;
    }
    if (shiftStart !== null) {
      const last = before[before.length - 1]!.at.getTime();
      const end = Math.max(
        Math.min(shiftStart + 8.5 * HOUR, cutoff - MINUTE),
        last + 1000,
      );
      if (breakStart !== null) {
        const breakEnd = Math.min(breakStart + 30 * MINUTE, end - MINUTE);
        await appendSeedEvent(tx, context, person, {
          type: "break_end",
          at: new Date(breakEnd),
        });
      }
      await appendSeedEvent(tx, context, person, {
        type: "clock_out",
        at: new Date(end),
      });
    }

    if (state === null) return;
    const todays = events.filter((event) => event.at.getTime() >= cutoff);
    const age = (event: EffectiveEvent | undefined) =>
      event ? now - event.at.getTime() : Number.NaN;
    const fits =
      state === "off"
        ? todays.length === 0
        : state === "working"
          ? todays.length === 1 &&
            todays[0]!.type === "clock_in" &&
            age(todays[0]) >= 3 * HOUR &&
            age(todays[0]) <= 4 * HOUR
          : todays.length === 2 &&
            todays[0]!.type === "clock_in" &&
            todays[1]!.type === "break_start" &&
            age(todays[0]) >= 3.5 * HOUR &&
            age(todays[0]) <= 4.5 * HOUR &&
            age(todays[1]) <= 40 * MINUTE;
    if (fits) return;

    for (const event of todays) {
      await appendSeedEvent(tx, context, person, {
        type: "void",
        at: event.at,
        supersedes: event.id,
      });
    }
    const since = (ago: number) => new Date(now - ago);
    if (state === "working") {
      await appendSeedEvent(tx, context, person, {
        type: "clock_in",
        at: since(3 * HOUR + 30 * MINUTE),
      });
    }
    if (state === "on_break") {
      await appendSeedEvent(tx, context, person, {
        type: "clock_in",
        at: since(4 * HOUR),
      });
      await appendSeedEvent(tx, context, person, {
        type: "break_start",
        at: since(18 * MINUTE),
      });
    }
  });
}

/** The screens accounts: made-up history and a realistic "today" for each. */
async function seedScreens(input: {
  dbUrl: string;
  orgId: string;
  siteId: string;
  deciderId: string;
  userIds: ReadonlyMap<string, string>;
}): Promise<void> {
  const sql = postgres(input.dbUrl, { max: 1, onnotice: () => undefined });
  const context: ScreensContext = {
    orgId: input.orgId,
    siteId: input.siteId,
    deciderId: input.deciderId,
  };
  try {
    for (const account of SCREENS_ACCOUNTS) {
      const userId = input.userIds.get(account.email);
      if (!userId) throw new Error(`${account.email} is not seeded`);
      const person = await screensPerson(sql, input.orgId, account.email, userId);
      if (account.schedule) {
        // Starting with the shift when there is one, otherwise in an hour.
        const started =
          account.today === "working" ? 210 : account.today === "on_break" ? 240 : -60;
        await setDailySchedule(
          sql,
          input.orgId,
          person.employeeId,
          input.deciderId,
          plannedBlock(Date.now(), started, 510),
        );
      }
      if (account.history) await seedScreensHistory(sql, context, person);
      await settleScreensToday(sql, context, person, account.today);
    }
  } finally {
    await sql.end();
  }
}

// Manager screens ------------------------------------------------------------------------

/**
 * `pnpm screens` of `/manage`: a fictional bakery of its own, so the
 * manager's screenshots never show the e2e accounts. Its owner
 * (screens-beheer@) is reserved for the screens; its team has logins too
 * (screens-team-*@), but nobody ever uses them. A second owner
 * (screens-beheer-leeg@) has an organization with nothing in it: the empty
 * states.
 */
const MANAGER_SCREENS = {
  email: "screens-beheer@demo.test",
  name: "Nora Vermeulen",
  org: "Bakkerij Zon (fictief)",
  mainSite: "Winkel Centrum (fictief)",
  secondSite: "Filiaal Station (fictief)",
};
const MANAGER_SCREENS_EMPTY = {
  email: "screens-beheer-leeg@demo.test",
  name: "Tine Leemans",
  org: "Nieuwe Zaak (fictief)",
};

type TeamSite = "main" | "second";
/** Today's events, minutes before now (yesterday evening when that crosses midnight). */
type TeamEvent = {
  type: Exclude<SeedEventType, "void">;
  ago: number;
  offline?: boolean;
};

interface TeamMember {
  slug: string;
  name: string;
  code: string;
  statute: "bediende" | "arbeider" | "student" | "flexi" | "interim";
  sites: readonly TeamSite[];
  /** Planned every day, relative to now (`ago` minutes, negative: later), or `null`. */
  plan: { ago: number; length: number } | null;
  today: readonly TeamEvent[];
  /** Yesterday's events, minutes after midnight (a forgotten clock-out, a late sync). */
  yesterday?: readonly { type: Exclude<SeedEventType, "void">; minute: number }[];
  history?: boolean;
  pin?: string;
  left?: boolean;
}

const TEAM: readonly TeamMember[] = [
  {
    slug: "amina",
    name: "Amina Peeters",
    code: "B-014",
    statute: "bediende",
    sites: ["main"],
    plan: { ago: 210, length: 510 },
    today: [{ type: "clock_in", ago: 204 }],
    history: true,
    pin: "4827",
  },
  {
    slug: "bram",
    name: "Bram Maes",
    code: "A-022",
    statute: "arbeider",
    sites: ["main"],
    plan: { ago: 235, length: 510 },
    today: [
      { type: "clock_in", ago: 230 },
      { type: "break_start", ago: 11 },
    ],
    pin: "5930",
  },
  {
    slug: "chiara",
    name: "Chiara Vos",
    code: "S-003",
    statute: "student",
    sites: ["main"],
    plan: { ago: 395, length: 360 },
    today: [
      { type: "clock_in", ago: 390 },
      { type: "break_start", ago: 270 },
      { type: "break_end", ago: 255 },
      { type: "clock_out", ago: 45 },
    ],
  },
  {
    slug: "driss",
    name: "Driss Aerts",
    code: "B-031",
    statute: "bediende",
    sites: ["main"],
    plan: { ago: -30, length: 510 },
    today: [],
    yesterday: [{ type: "clock_in", minute: 7 * 60 + 58 }],
  },
  {
    slug: "lotte",
    name: "Lotte De Smet",
    code: "F-007",
    statute: "flexi",
    sites: ["second"],
    plan: { ago: -60, length: 270 },
    today: [],
  },
  {
    slug: "mohamed",
    name: "Mohamed El Idrissi",
    code: "A-018",
    statute: "arbeider",
    sites: ["second"],
    plan: { ago: 155, length: 510 },
    today: [{ type: "clock_in", ago: 150, offline: true }],
    // The clock-in was queued offline and did not fit: it waits as a request.
    yesterday: [
      { type: "break_start", minute: 12 * 60 + 10 },
      { type: "break_end", minute: 12 * 60 + 40 },
      { type: "clock_out", minute: 17 * 60 + 32 },
    ],
  },
  {
    slug: "maximiliaan",
    name: "Maximiliaan Van den Broeck-Vercruysse",
    code: "I-102",
    statute: "interim",
    sites: ["main", "second"],
    plan: { ago: 100, length: 510 },
    today: [
      { type: "clock_in", ago: 95 },
      { type: "break_start", ago: 50 },
      { type: "break_end", ago: 30 },
    ],
  },
  {
    slug: "sofie",
    name: "Sofie Janssens",
    code: "B-040",
    statute: "bediende",
    sites: ["main"],
    plan: null,
    today: [],
  },
  {
    slug: "pieter",
    name: "Pieter Wouters",
    code: "B-009",
    statute: "bediende",
    sites: ["main"],
    plan: null,
    today: [],
    left: true,
  },
];
const TEAM_INVITED = {
  email: "screens-team-yasmine@demo.test",
  name: "Yasmine Claes",
  code: "B-045",
};

type Session = { client: Client; factorId: string };

/** The organization owned by `ownerId` with this name, created when missing. */
async function ensureOwnedOrganization(
  admin: Client,
  ownerId: string,
  name: string,
  ownerName: string,
): Promise<string> {
  const { data: owned, error } = await admin
    .from("memberships")
    .select("organization_id, organizations!inner(name)")
    .eq("user_id", ownerId)
    .eq("role", "owner")
    .eq("organizations.name", name);
  if (error) fail("memberships", error);
  const existing = owned[0]?.organization_id;
  if (existing) return existing;
  const { data, error: createError } = await admin.rpc(
    "rpc_admin_create_organization",
    {
      p_name: name,
      p_owner_user_id: ownerId,
      p_owner_display_name: ownerName,
    },
  );
  if (createError || !data[0]) fail("rpc_admin_create_organization", createError);
  return data[0].organization_id;
}

/** Desired events on and after `from`; returns false when they already fit. */
function eventsFit(
  current: readonly EffectiveEvent[],
  desired: readonly { type: string; at: Date }[],
): boolean {
  return (
    current.length === desired.length &&
    current.every(
      (event, index) =>
        event.type === desired[index]!.type &&
        Math.abs(event.at.getTime() - desired[index]!.at.getTime()) <= 30 * MINUTE,
    )
  );
}

async function seedManagerScreens(input: {
  dbUrl: string;
  admin: Client;
  ensureUser: (email: string) => Promise<string>;
  privilegedSession: (email: string, userId: string) => Promise<Session>;
  signIn: (email: string) => Promise<Client>;
  /** A seed-only user, so no request is ever the manager's own. */
  requesterId: string;
}): Promise<void> {
  const { admin, ensureUser } = input;
  const ownerId = await ensureUser(MANAGER_SCREENS.email);
  const orgId = await ensureOwnedOrganization(
    admin,
    ownerId,
    MANAGER_SCREENS.org,
    MANAGER_SCREENS.name,
  );
  const emptyOwnerId = await ensureUser(MANAGER_SCREENS_EMPTY.email);
  await ensureOwnedOrganization(
    admin,
    emptyOwnerId,
    MANAGER_SCREENS_EMPTY.org,
    MANAGER_SCREENS_EMPTY.name,
  );

  const sql = postgres(input.dbUrl, { max: 1, onnotice: () => undefined });
  let session: Session | null = null;
  const owner = async () =>
    (session ??= await input.privilegedSession(MANAGER_SCREENS.email, ownerId));

  try {
    // Sites: the default one is renamed once, the second is added once.
    const sites = await sql<{ id: string; name: string }[]>`
      select id, name from public.sites where organization_id = ${orgId} order by created_at`;
    const main = sites[0]!;
    if (main.name !== MANAGER_SCREENS.mainSite) {
      await sql`update public.sites set name = ${MANAGER_SCREENS.mainSite} where id = ${main.id}`;
    }
    let second = sites.find((site) => site.name === MANAGER_SCREENS.secondSite)?.id;
    if (!second) {
      const [row] = await sql<{ id: string }[]>`
        insert into public.sites (organization_id, name)
        values (${orgId}, ${MANAGER_SCREENS.secondSite}) returning id`;
      second = row!.id;
    }
    const siteIds: Record<TeamSite, string> = { main: main.id, second };
    const [ownerEmployee] = await sql<{ id: string }[]>`
      select id from public.employees where organization_id = ${orgId} and user_id = ${ownerId}`;
    if (ownerEmployee) {
      await sql`
        insert into public.site_assignments (organization_id, site_id, employee_id)
        values (${orgId}, ${siteIds.main}, ${ownerEmployee.id})
        on conflict (organization_id, site_id, employee_id) do nothing`;
    }

    // The team: invited by the owner, linked and accepted like a first login.
    const people = new Map<string, ScreensPerson>();
    for (const member of TEAM) {
      const email = `screens-team-${member.slug}@demo.test`;
      const userId = await ensureUser(email);
      const [membership] = await sql<{ status: string }[]>`
        select status from public.memberships
        where organization_id = ${orgId} and user_id = ${userId}`;
      if (!membership) {
        const [open] = await sql<{ id: string }[]>`
          select id from public.invitations
          where organization_id = ${orgId} and email = ${email}
            and status in ('pending', 'linked') and expires_at > now()`;
        let invitationId = open?.id;
        if (!invitationId) {
          const { data, error } = await (
            await owner()
          ).client.rpc("rpc_invite_member", {
            p_org: orgId,
            p_email: email,
            p_role: "employee",
            p_display_name: member.name,
            p_site_ids: member.sites.map((site) => siteIds[site]),
            p_employee_code: member.code,
            p_statute: member.statute,
          });
          if (error) fail("rpc_invite_member", error);
          invitationId = data;
        }
        const { error: linkError } = await admin.rpc("rpc_link_invited_user", {
          p_invitation_id: invitationId,
          p_user_id: userId,
        });
        if (linkError) fail("rpc_link_invited_user", linkError);
      }
      if (!membership || membership.status === "invited") {
        const memberClient = await input.signIn(email);
        const { error } = await memberClient.rpc("rpc_accept_membership");
        if (error) fail("rpc_accept_membership", error);
        await memberClient.auth.signOut({ scope: "local" });
      }
      people.set(member.slug, await screensPerson(sql, orgId, email, userId));
    }

    // One invitation still open.
    const [invited] = await sql`
      select 1 from public.invitations
      where organization_id = ${orgId} and email = ${TEAM_INVITED.email}`;
    if (!invited) {
      const { error } = await (
        await owner()
      ).client.rpc("rpc_invite_member", {
        p_org: orgId,
        p_email: TEAM_INVITED.email,
        p_role: "employee",
        p_display_name: TEAM_INVITED.name,
        p_site_ids: [siteIds.main],
        p_employee_code: TEAM_INVITED.code,
        p_statute: "bediende",
      });
      if (error) fail("rpc_invite_member", error);
    }

    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    const today = DAY_KEY.format(new Date(now));
    const midnight = brussels(today, 0).getTime();
    const yesterday = DAY_KEY.format(new Date(midnight - 12 * HOUR));
    // Relative to now: just after midnight these land on yesterday evening.
    const since = (ago: number) => new Date(now - ago * MINUTE);

    for (const member of TEAM) {
      const person = people.get(member.slug)!;
      const context: ScreensContext = {
        orgId,
        siteId: siteIds[member.sites[0]!],
        deciderId: ownerId,
      };

      if (member.plan) {
        await setDailySchedule(
          sql,
          orgId,
          person.employeeId,
          ownerId,
          plannedBlock(now, member.plan.ago, member.plan.length),
        );
      }
      if (member.history) {
        await seedScreensHistory(sql, context, person, {
          pendingRequest: false,
          offlineDay: false,
        });
      }

      // Today (and yesterday for a forgotten clock-out), made to fit on every run.
      // Without yesterday's events the window is the last seven hours, so earlier
      // history (amina's normal shift yesterday) is left alone.
      const from = member.yesterday ? brussels(yesterday, 0).getTime() : now - 7 * HOUR;
      const desired = [
        ...(member.yesterday ?? []).map((event) => ({
          type: event.type,
          at: brussels(yesterday, event.minute),
          offline: false,
        })),
        ...member.today.map((event) => ({
          type: event.type,
          at: since(event.ago),
          offline: event.offline ?? false,
        })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        const events = await effectiveEventsOf(tx, person.employeeId);
        const before = events.filter((event) => event.at.getTime() < from);
        const last = before.at(-1);
        if (last && last.type !== "clock_out") {
          if (last.type === "break_start") {
            await appendSeedEvent(tx, context, person, {
              type: "break_end",
              at: new Date(
                Math.min(last.at.getTime() + 30 * MINUTE, from - 2 * MINUTE),
              ),
            });
          }
          await appendSeedEvent(tx, context, person, {
            type: "clock_out",
            at: new Date(Math.min(last.at.getTime() + 8.5 * HOUR, from - MINUTE)),
          });
        }
        const current = events.filter((event) => event.at.getTime() >= from);
        if (eventsFit(current, desired)) return;
        for (const event of current) {
          await appendSeedEvent(tx, context, person, {
            type: "void",
            at: event.at,
            supersedes: event.id,
          });
        }
        for (const event of desired) {
          await appendSeedEvent(tx, context, person, event);
        }
      });
    }

    // Two open requests, one of them offline; stale ones from an earlier day are withdrawn.
    const requests = [
      {
        member: "driss",
        offline: false,
        type: "clock_out",
        at: brussels(yesterday, 16 * 60 + 35),
        reason: "Ik vergat uit te klokken na de sluiting.",
      },
      {
        member: "mohamed",
        offline: true,
        type: "clock_in",
        at: brussels(yesterday, 8 * 60 + 57),
        reason: null,
      },
    ] as const;
    for (const request of requests) {
      const person = people.get(request.member)!;
      const open = await sql<{ id: string; created_at: Date; proposed: unknown }[]>`
        select id, created_at, proposed from public.correction_requests
        where employee_id = ${person.employeeId} and status = 'pending'`;
      // Still the request we want: made today, for the same moment.
      const current = (row: (typeof open)[number]) =>
        DAY_KEY.format(row.created_at) === today &&
        (row.proposed as { events?: { occurred_at?: string }[] }).events?.[0]
          ?.occurred_at === request.at.toISOString();
      const fresh = open.filter(current);
      const stale = open.filter((row) => !current(row));
      if (stale.length > 0) {
        await sql.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          for (const row of stale) {
            await tx`
              update public.correction_requests
              set status = 'withdrawn', decided_by = ${input.requesterId}, decided_at = now()
              where id = ${row.id}`;
          }
        });
      }
      if (fresh.length > 0) continue;
      const proposed = {
        events: [
          {
            type: request.type,
            occurred_at: request.at.toISOString(),
            site_id: siteIds[request.member === "mohamed" ? "second" : "main"],
          },
        ],
      };
      await sql`
        insert into public.correction_requests (
          organization_id, employee_id, requested_by, kind, proposed, reason,
          offline, idempotency_key, offline_reason)
        values (
          ${orgId}, ${person.employeeId}, ${input.requesterId}, 'add', ${sql.json(proposed)},
          ${request.reason}, ${request.offline},
          ${request.offline ? sql`gen_random_uuid()` : null},
          ${request.offline ? "later_event_exists" : null})`;
    }

    // Kiosk PINs, kiosks and "uit dienst": once, through the real RPCs (they write the log).
    for (const member of TEAM) {
      const person = people.get(member.slug)!;
      if (member.pin) {
        const [pin] = await sql`
          select 1 from public.employee_pins where employee_id = ${person.employeeId}`;
        if (!pin) {
          const { error } = await (
            await owner()
          ).client.rpc("rpc_set_employee_pin", {
            p_employee_id: person.employeeId,
            p_pin: member.pin,
          });
          if (error) fail("rpc_set_employee_pin", error);
        }
      }
      if (member.left) {
        const [row] = await sql<{ left_at: string | null }[]>`
          select left_at from public.employees where id = ${person.employeeId}`;
        if (!row?.left_at) {
          const { error } = await (
            await owner()
          ).client.rpc("rpc_offboard_employee", {
            p_employee_id: person.employeeId,
          });
          if (error) fail("rpc_offboard_employee", error);
        }
      }
    }
    const [kiosk] = await sql`
      select 1 from public.kiosk_devices where organization_id = ${orgId} limit 1`;
    if (!kiosk) {
      for (const [site, name] of [
        ["main", "Tablet aan de ingang"],
        ["second", "Tablet achter de toonbank"],
      ] as const) {
        const { error } = await (
          await owner()
        ).client.rpc("rpc_kiosk_create", {
          p_site_id: siteIds[site],
          p_name: name,
        });
        if (error) fail("rpc_kiosk_create", error);
      }
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          update public.kiosk_devices set last_seen_at = now() - interval '12 minutes'
          where organization_id = ${orgId} and site_id = ${siteIds.main}`;
      });
    }

    // Two earlier exports (made-up content: never downloaded in the screens).
    const [anyExport] = await sql`
      select 1 from public.exports where organization_id = ${orgId} limit 1`;
    if (!anyExport) {
      const [y = 2026, m = 1] = today.split("-").map(Number);
      for (const [back, rows] of [
        [1, 184],
        [2, 171],
      ] as const) {
        const first = new Date(Date.UTC(y, m - 1 - back, 1));
        const last = new Date(Date.UTC(y, m - back, 0));
        const content = Buffer.from(
          JSON.stringify({ format: "cloxa.export.v1", seed: true, rows: [] }),
          "utf8",
        );
        await sql`
          insert into public.exports (
            organization_id, site_ids, period_from, period_to, format_version, created_by,
            created_at, row_count, content_sha256, signature, signing_key_id, content)
          values (
            ${orgId}, null, ${first.toISOString().slice(0, 10)}, ${last.toISOString().slice(0, 10)},
            'cloxa.export.v1', ${ownerId}, ${new Date(last.getTime() + 2 * 86_400_000 + 9 * HOUR)},
            ${rows}, extensions.digest(${content}, 'sha256'), extensions.gen_random_bytes(64),
            'seed', ${content})`;
      }
    }
  } finally {
    await sql.end();
    if (session) {
      const { factorId, client } = session as Session;
      await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: ownerId });
      await client.auth.signOut({ scope: "local" });
    }
  }
}

// Modules (ADR 008) ------------------------------------------------------------------------

/**
 * Two organizations of their own, so no other screen or spec ever sees a
 * module switched on:
 * - "Modules Test (fictief)": modules-owner-e2e@ (owner) and modules-e2e@ (a
 *   student), reserved for modules.spec.ts. The spec switches the modules
 *   itself; the seed only makes sure the people exist.
 * - "Kantoor Verbeke (fictief)": screens-modules@ (owner), a student
 *   (screens-modules-student@: Monday and Thursday afternoons since 1
 *   January, relative to now, and no shift today) and an interim worker
 *   (screens-modules-interim@), four modules on (flexi off) and an agency
 *   export: the module screens in `pnpm screens`.
 */
const MODULES_E2E = {
  org: "Modules Test (fictief)",
  owner: { email: "modules-owner-e2e@demo.test", name: "Mona Moduletest" },
  student: {
    email: "modules-e2e@demo.test",
    name: "Stijn Studenttest",
    code: "S-900",
    statute: "student",
  },
} as const;
const MODULES_SCREENS = {
  org: "Kantoor Verbeke (fictief)",
  owner: { email: "screens-modules@demo.test", name: "Karin Verbeke" },
  student: {
    email: "screens-modules-student@demo.test",
    name: "Lena Vermeiren",
    code: "S-021",
    statute: "student",
  },
  interim: {
    email: "screens-modules-interim@demo.test",
    name: "Yusuf Demir",
    code: "I-310",
    statute: "interim",
  },
  agency: "Tempo Uitzend (fictief)",
  agencyReference: "TU-4471",
} as const;

/** Same JSON value, whatever the key order (jsonb reorders keys). */
function sameJson(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
        )
      : value;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

interface ModulesSeedInput {
  dbUrl: string;
  admin: Client;
  ensureUser: (email: string) => Promise<string>;
  privilegedSession: (email: string, userId: string) => Promise<Session>;
  signIn: (email: string) => Promise<Client>;
}

/** An employee of `orgId` on `siteId`, invited, linked and accepted like a first login. */
async function ensureModuleMember(
  input: ModulesSeedInput,
  sql: Sql,
  owner: () => Promise<Session>,
  orgId: string,
  siteId: string,
  member: { email: string; name: string; code: string; statute: string },
): Promise<ScreensPerson> {
  const userId = await input.ensureUser(member.email);
  const [membership] = await sql<{ status: string }[]>`
    select status from public.memberships
    where organization_id = ${orgId} and user_id = ${userId}`;
  if (!membership) {
    const [open] = await sql<{ id: string }[]>`
      select id from public.invitations
      where organization_id = ${orgId} and email = ${member.email}
        and status in ('pending', 'linked') and expires_at > now()`;
    let invitationId = open?.id;
    if (!invitationId) {
      const { data, error } = await (
        await owner()
      ).client.rpc("rpc_invite_member", {
        p_org: orgId,
        p_email: member.email,
        p_role: "employee",
        p_display_name: member.name,
        p_site_ids: [siteId],
        p_employee_code: member.code,
        p_statute: member.statute,
      });
      if (error) fail("rpc_invite_member", error);
      invitationId = data;
    }
    const { error: linkError } = await input.admin.rpc("rpc_link_invited_user", {
      p_invitation_id: invitationId,
      p_user_id: userId,
    });
    if (linkError) fail("rpc_link_invited_user", linkError);
  }
  if (!membership || membership.status === "invited") {
    const memberClient = await input.signIn(member.email);
    const { error } = await memberClient.rpc("rpc_accept_membership");
    if (error) fail("rpc_accept_membership", error);
    await memberClient.auth.signOut({ scope: "local" });
  }
  return screensPerson(sql, orgId, member.email, userId);
}

/** Monday and Thursday afternoons from 1 January up to yesterday, relative to now. */
async function seedStudentYear(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
): Promise<void> {
  const existing = await sql<{ occurred_at: Date }[]>`
    select occurred_at from public.clock_events where employee_id = ${person.employeeId}`;
  const busyDays = new Set(existing.map((row) => DAY_KEY.format(row.occurred_at)));

  const now = Date.now();
  const today = DAY_KEY.format(new Date(now));
  const newYear = `${today.slice(0, 4)}-01-01`;
  // This month and the last one have a location: telework was on by then.
  const located = DAY_KEY.format(new Date(now - 31 * 86_400_000)).slice(0, 7);
  const days: string[] = [];
  for (let back = 1; back <= 366; back += 1) {
    const probe = new Date(now - back * 86_400_000);
    const day = DAY_KEY.format(probe);
    if (day < newYear) break;
    if (["Mon", "Thu"].includes(WEEKDAY.format(probe)) && !busyDays.has(day)) {
      days.push(day);
    }
  }
  if (days.length === 0) return;

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const [index, day] of days.entries()) {
      const jitter = (index * 7) % 11;
      const thursday = WEEKDAY.format(brussels(day, 12 * 60)) === "Thu";
      const workLocation =
        day.slice(0, 7) >= located ? (thursday ? "home" : "site") : undefined;
      await appendSeedEvent(tx, context, person, {
        type: "clock_in",
        at: brussels(day, 13 * 60 - 3 + jitter),
        ...(workLocation ? { workLocation } : {}),
      });
      await appendSeedEvent(tx, context, person, {
        type: "clock_out",
        at: brussels(day, 17 * 60 + 25 + ((jitter * 3) % 13)),
      });
    }
  });
}

async function seedModules(input: ModulesSeedInput): Promise<void> {
  const sql = postgres(input.dbUrl, { max: 1, onnotice: () => undefined });
  const sessions: { userId: string; session: Session }[] = [];
  const ownerSession = (email: string, userId: string) => {
    let session: Session | null = null;
    return async () => {
      if (session === null) {
        session = await input.privilegedSession(email, userId);
        sessions.push({ userId, session });
      }
      return session;
    };
  };
  const mainSite = async (orgId: string) => {
    const [site] = await sql<{ id: string }[]>`
      select id from public.sites where organization_id = ${orgId} order by created_at limit 1`;
    if (!site) throw new Error("an organization without a site");
    return site.id;
  };

  try {
    // The e2e organization: the people only.
    {
      const ownerId = await input.ensureUser(MODULES_E2E.owner.email);
      const orgId = await ensureOwnedOrganization(
        input.admin,
        ownerId,
        MODULES_E2E.org,
        MODULES_E2E.owner.name,
      );
      await ensureModuleMember(
        input,
        sql,
        ownerSession(MODULES_E2E.owner.email, ownerId),
        orgId,
        await mainSite(orgId),
        MODULES_E2E.student,
      );
    }

    // The screens organization.
    const ownerId = await input.ensureUser(MODULES_SCREENS.owner.email);
    const orgId = await ensureOwnedOrganization(
      input.admin,
      ownerId,
      MODULES_SCREENS.org,
      MODULES_SCREENS.owner.name,
    );
    const siteId = await mainSite(orgId);
    const owner = ownerSession(MODULES_SCREENS.owner.email, ownerId);
    const student = await ensureModuleMember(
      input,
      sql,
      owner,
      orgId,
      siteId,
      MODULES_SCREENS.student,
    );
    const interim = await ensureModuleMember(
      input,
      sql,
      owner,
      orgId,
      siteId,
      MODULES_SCREENS.interim,
    );

    // Switched on and set through the real RPCs (they write the log), only
    // when something differs.
    const desired: Record<
      string,
      { enabled: boolean; config: Record<string, string> }
    > = {
      student: { enabled: true, config: {} },
      flexi: { enabled: false, config: {} },
      interim: { enabled: true, config: {} },
      overuren: { enabled: true, config: { sector: "general" } },
      telework: { enabled: true, config: {} },
    };
    const current = await sql<{ module: string; enabled: boolean; config: unknown }[]>`
      select module, enabled, config from public.org_modules where organization_id = ${orgId}`;
    for (const [id, want] of Object.entries(desired)) {
      const row = current.find((candidate) => candidate.module === id);
      if (
        row
          ? row.enabled === want.enabled && sameJson(row.config, want.config)
          : !want.enabled
      ) {
        continue;
      }
      const { error } = await (
        await owner()
      ).client.rpc("rpc_set_org_module", {
        p_org: orgId,
        p_module: id,
        p_enabled: want.enabled,
        p_config: want.config,
      });
      if (error) fail("rpc_set_org_module", error);
    }

    const today = DAY_KEY.format(new Date());
    const data: [ScreensPerson, string, Record<string, string | number>][] = [
      [
        student,
        "student",
        { hours_elsewhere: 120, checked_on: `${today.slice(0, 7)}-01` },
      ],
      [
        interim,
        "interim",
        {
          agency_name: MODULES_SCREENS.agency,
          agency_reference: MODULES_SCREENS.agencyReference,
        },
      ],
    ];
    for (const [person, id, want] of data) {
      const [row] = await sql<{ data: unknown }[]>`
        select data from public.employee_module_data
        where employee_id = ${person.employeeId} and module = ${id}`;
      if (row && sameJson(row.data, want)) continue;
      const { error } = await (
        await owner()
      ).client.rpc("rpc_set_employee_module_data", {
        p_employee_id: person.employeeId,
        p_module: id,
        p_data: want,
      });
      if (error) fail("rpc_set_employee_module_data", error);
    }

    // The student: a plan for Monday and Thursday afternoons, the year so
    // far, and nothing running today (so Klok asks "Waar werk je vandaag?").
    const [schedule] = await sql`
      select 1 from public.schedules where employee_id = ${student.employeeId} limit 1`;
    if (!schedule) {
      const afternoon = [{ start: "13:00", end: "17:30" }];
      await sql`
        insert into public.schedules
          (organization_id, employee_id, version, valid_from, pattern, created_by, notified_at)
        values (${orgId}, ${student.employeeId}, 1, ${`${today.slice(0, 4)}-01-01`},
          ${sql.json({ mon: afternoon, thu: afternoon })}, ${ownerId}, now())`;
    }
    const context: ScreensContext = { orgId, siteId, deciderId: ownerId };
    await seedStudentYear(sql, context, student);
    await settleScreensToday(sql, context, student, "off");
    await seedScreensHistory(sql, context, interim, {
      pendingRequest: false,
      offlineDay: false,
    });
    await settleScreensToday(sql, context, interim, "off");

    // Two earlier exports, one for the agency (made-up content: never downloaded).
    const [anyExport] = await sql`
      select 1 from public.exports where organization_id = ${orgId} limit 1`;
    if (!anyExport) {
      const [y = 2026, m = 1] = today.split("-").map(Number);
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      for (const [agency, rows, hours] of [
        [null, 46, 9],
        [MODULES_SCREENS.agency, 19, 10],
      ] as const) {
        const content = Buffer.from(
          JSON.stringify({ format: "cloxa.export.v1", seed: true, rows: [] }),
          "utf8",
        );
        await sql`
          insert into public.exports (
            organization_id, site_ids, period_from, period_to, format_version, created_by,
            created_at, row_count, content_sha256, signature, signing_key_id, content,
            interim_agency)
          values (
            ${orgId}, null, ${first.toISOString().slice(0, 10)}, ${last.toISOString().slice(0, 10)},
            'cloxa.export.v1', ${ownerId}, ${new Date(last.getTime() + 2 * 86_400_000 + hours * HOUR)},
            ${rows}, extensions.digest(${content}, 'sha256'), extensions.gen_random_bytes(64),
            'seed', ${content}, ${agency})`;
      }
    }
  } finally {
    await sql.end();
    for (const { userId, session } of sessions) {
      await input.admin.auth.admin.mfa.deleteFactor({ id: session.factorId, userId });
      await session.client.auth.signOut({ scope: "local" });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
