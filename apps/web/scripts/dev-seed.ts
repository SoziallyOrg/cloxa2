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

  async function privilegedOwner(): Promise<{ client: Client; factorId: string }> {
    // Enrolling at aal1 is refused once a verified factor exists, so the
    // seed-owner's factors are reset on every run. This account is never
    // logged into by a human, so this never breaks a manual session.
    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: seedOwnerId,
    });
    if (listError) fail("admin.mfa.listFactors", listError);
    for (const factor of factors.factors) {
      await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: seedOwnerId });
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: SEED_OWNER.email,
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
  },
): Promise<string> {
  const correction = event.type === "void" || event.supersedes !== undefined;
  const [head] = await tx<{ prev: Buffer }[]>`
    select private.chain_lock_head(${context.orgId}::uuid, 'clock_events') as prev`;
  const [row] = await tx<{ id: string }[]>`
    insert into public.clock_events (
      organization_id, site_id, employee_id, type, occurred_at, client_captured_at,
      source, supersedes_event_id, correction_id, actor_user_id, idempotency_key,
      offline, prev_hash, hash)
    values (
      ${context.orgId}, ${context.siteId}, ${person.employeeId}, ${event.type}, ${event.at},
      ${event.offline ? event.at : null}, ${correction ? "correction" : "app"},
      ${event.supersedes ?? null}, ${event.correctionId ?? null},
      ${correction ? context.deciderId : person.userId}, gen_random_uuid(),
      ${event.offline ?? false}, ${head!.prev},
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

/** 08:00–16:30 every day, so the clock shows its progress track on any day. */
async function ensureDailySchedule(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
): Promise<void> {
  const [schedule] = await sql`
    select 1 from public.schedules
    where organization_id = ${context.orgId} and employee_id = ${person.employeeId} limit 1`;
  if (schedule) return;
  const block = [{ start: "08:00", end: "16:30" }];
  const pattern = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, block]),
  );
  await sql`
    insert into public.schedules
      (organization_id, employee_id, version, valid_from, pattern, created_by, notified_at)
    values (${context.orgId}, ${person.employeeId}, 1, ${"2026-01-01"},
      ${sql.json(pattern)}, ${context.deciderId}, now())`;
}

/**
 * Weekday shifts over the last three weeks (one corrected, one offline) and
 * three questions. Idempotent: a day that already has events is left alone.
 */
async function seedScreensHistory(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
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
      const offline = index === 1;
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
 * - a shift left open on an earlier day is closed about 8.5 hours after it began;
 * - `working`: one clock-in about 3 h 24 min ago;
 * - `on_break`: a clock-in about 3 h 50 min ago and a break since 11 minutes;
 * - `off`: nothing today.
 * Today's events that don't fit are voided (the standard "remove" correction),
 * so reruns on the same day never pile up short shifts.
 */
async function settleScreensToday(
  sql: Sql,
  context: ScreensContext,
  person: ScreensPerson,
  state: TodayState,
): Promise<void> {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const today = DAY_KEY.format(new Date(now));
  const midnight = brussels(today, 0).getTime();

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const events = await effectiveEventsOf(tx, person.employeeId);

    // Close a shift left open before today.
    const before = events.filter((event) => event.at.getTime() < midnight);
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
      const end = Math.min(
        Math.max(shiftStart + 8.5 * HOUR, last + 5 * MINUTE),
        now - HOUR,
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
    const todays = events.filter((event) => event.at.getTime() >= midnight);
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
            age(todays[0]) >= 3 * HOUR &&
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
    // Never before today's midnight, so a run just after midnight stays "today".
    const since = (ago: number) => new Date(Math.max(now - ago, midnight + MINUTE));
    if (state === "working") {
      await appendSeedEvent(tx, context, person, {
        type: "clock_in",
        at: since(3 * HOUR + 24 * MINUTE),
      });
    }
    if (state === "on_break") {
      await appendSeedEvent(tx, context, person, {
        type: "clock_in",
        at: since(3 * HOUR + 50 * MINUTE),
      });
      await appendSeedEvent(tx, context, person, {
        type: "break_start",
        at: since(11 * MINUTE),
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
      if (account.schedule) await ensureDailySchedule(sql, context, person);
      if (account.history) await seedScreensHistory(sql, context, person);
      await settleScreensToday(sql, context, person, account.today);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
