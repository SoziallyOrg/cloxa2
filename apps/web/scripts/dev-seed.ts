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
 * Codes arrive in the local Mailpit: http://127.0.0.1:54324
 *
 * Refuses to run unless both the Supabase API and the database are on
 * loopback. Uses the secret key (admin API, service_role RPCs) and, for the
 * invitations, a short-lived owner session with a throwaway TOTP factor,
 * because `rpc_invite_member` requires fresh MFA like any real inviter.
 * There is no site RPC yet, so the second site is inserted with SQL.
 *
 * Runs on Node's built-in TypeScript support: erasable syntax only, and
 * type-only imports from workspace packages.
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import type { Database } from "@cloxa/db";

type Client = SupabaseClient<Database>;
type Role = "admin" | "manager" | "employee";
type SiteKey = "main" | "second";

const ORG_NAME = "Bakkerij Demo (fictief)";
const SECOND_SITE_NAME = "Filiaal Markt (fictief)";
const OWNER = { email: "eigenaar@demo.test", name: "Olivia Eigenaar" };
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

  // Members -------------------------------------------------------------------------------
  let owner: { client: Client; factorId: string } | null = null;

  async function privilegedOwner(): Promise<{ client: Client; factorId: string }> {
    // Enrolling at aal1 is refused once a verified factor exists, so the
    // owner's factors are reset. Local, fictional data only.
    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: ownerId,
    });
    if (listError) fail("admin.mfa.listFactors", listError);
    if (factors.factors.length > 0) {
      console.log(
        "Note: the owner's TOTP factors were reset; set up a new one at /manage.",
      );
    }
    for (const factor of factors.factors) {
      await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: ownerId });
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: OWNER.email,
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
      await admin.auth.admin.mfa.deleteFactor({ id: owner.factorId, userId: ownerId });
      await owner.client.auth.signOut({ scope: "local" });
    }
  }

  console.log(
    `Demo organization ready: 2 sites, ${MEMBERS.length + 1} accounts (${created} newly linked).`,
  );
  console.log(
    "Log in at /login with an address listed in apps/web/scripts/dev-seed.ts.",
  );
  console.log("Codes arrive in Mailpit: http://127.0.0.1:54324");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
