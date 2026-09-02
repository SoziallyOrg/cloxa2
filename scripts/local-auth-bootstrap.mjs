import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  getLocalStackStatus,
  loadLocalEnvironment,
  LocalAuthError,
  localOnlyFetch,
  projectRoot,
  requireFictionalEmail,
  requireLocalPassword,
  requireLocalOrigin,
  validateBootstrapArguments,
  validateLocalStack,
} from "./local-auth-config.mjs";

export const localFixture = Object.freeze({
  marker: "cloxa-local-manager-v1",
  organization: Object.freeze({
    id: "10000000-0000-4000-8000-000000000001",
    lifecycle_status: "research_pilot",
    name: "Fictief Atelier De Proefklok",
  }),
  worksite: Object.freeze({
    id: "11000000-0000-4000-8000-000000000001",
    name: "Fictieve testwerkplaats",
    organization_id: "10000000-0000-4000-8000-000000000001",
    timezone: "Europe/Brussels",
  }),
  membershipId: "12000000-0000-4000-8000-000000000001",
  displayName: "Fictieve beheerder",
});

export function assertFixtureMatches(existing, expected, label) {
  if (
    existing &&
    Object.entries(expected).some(([field, value]) => existing[field] !== value)
  ) {
    throw new LocalAuthError(
      `Local ${label} conflicts with an existing record. No overwrite performed.`,
    );
  }
}

function requireResult(result, operation) {
  if (result.error) {
    // Auth and database error objects may contain private data; keep them out of output.
    throw new LocalAuthError(
      `Local bootstrap ${operation} failed. No credentials were logged.`,
    );
  }

  return result.data;
}

async function findManager(admin, email) {
  for (let page = 1; page <= 100; page += 1) {
    const data = requireResult(
      await admin.auth.admin.listUsers({ page, perPage: 100 }),
      "account lookup",
    );
    const matches = data.users.filter((user) => user.email?.toLowerCase() === email);

    if (matches.length > 1) {
      throw new LocalAuthError(
        "Local manager email is ambiguous. No overwrite performed.",
      );
    }

    if (matches[0]) {
      const user = matches[0];

      if (
        user.app_metadata?.cloxa_local_fixture !== localFixture.marker ||
        !user.email_confirmed_at
      ) {
        throw new LocalAuthError(
          "Existing account is not this confirmed local manager fixture.",
        );
      }

      return user;
    }

    if (data.users.length < 100) {
      return null;
    }
  }

  throw new LocalAuthError(
    "Local account lookup limit exceeded. No accounts were changed.",
  );
}

async function readFixture(admin, table, key, value) {
  return requireResult(
    await admin.from(table).select("*").eq(key, value).maybeSingle(),
    `${table} lookup`,
  );
}

async function ensureFixture(admin, table, key, expected) {
  const existing = await readFixture(admin, table, key, expected[key]);
  assertFixtureMatches(existing, expected, table);

  if (!existing) {
    requireResult(
      await admin
        .from(table)
        .upsert(expected, { onConflict: key, ignoreDuplicates: true }),
      `${table} creation`,
    );
  }

  const stored = await readFixture(admin, table, key, expected[key]);

  if (!stored) {
    throw new LocalAuthError(`Local ${table} was not created.`);
  }

  assertFixtureMatches(stored, expected, table);
}

export async function bootstrapManager(admin, credentials) {
  const email = requireFictionalEmail(credentials.email);
  const password = requireLocalPassword(
    credentials.password,
    "CLOXA_LOCAL_MANAGER_PASSWORD",
  );
  let user = await findManager(admin, email);

  const organization = await readFixture(
    admin,
    "organizations",
    "id",
    localFixture.organization.id,
  );
  const worksite = await readFixture(
    admin,
    "worksites",
    "id",
    localFixture.worksite.id,
  );
  assertFixtureMatches(organization, localFixture.organization, "organization");
  assertFixtureMatches(worksite, localFixture.worksite, "worksite");

  const fixedMembership = await readFixture(
    admin,
    "memberships",
    "id",
    localFixture.membershipId,
  );
  if (fixedMembership && (!user || fixedMembership.user_id !== user.id)) {
    throw new LocalAuthError(
      "Local membership ID belongs to another account. No overwrite performed.",
    );
  }

  if (user) {
    const profile = await readFixture(admin, "profiles", "user_id", user.id);
    assertFixtureMatches(
      profile,
      { display_name: localFixture.displayName, locale: "nl-BE", user_id: user.id },
      "profile",
    );
    assertFixtureMatches(
      fixedMembership,
      {
        employee_code: null,
        id: localFixture.membershipId,
        organization_id: localFixture.organization.id,
        role: "manager",
        status: "active",
        user_id: user.id,
      },
      "membership",
    );

    const userMemberships = requireResult(
      await admin.from("memberships").select("*").eq("user_id", user.id),
      "account membership lookup",
    );
    if (
      userMemberships.some((membership) => membership.id !== localFixture.membershipId)
    ) {
      throw new LocalAuthError(
        "Local manager has another membership. No overwrite performed.",
      );
    }
  }

  const memberships = requireResult(
    await admin
      .from("memberships")
      .select("*")
      .eq("organization_id", localFixture.organization.id)
      .eq("role", "manager"),
    "manager membership lookup",
  );

  if (memberships.some((membership) => !user || membership.user_id !== user.id)) {
    throw new LocalAuthError(
      "Local fixture organization already has another manager. No overwrite performed.",
    );
  }

  if (!user) {
    const data = requireResult(
      await admin.auth.admin.createUser({
        app_metadata: { cloxa_local_fixture: localFixture.marker },
        email,
        email_confirm: true,
        password,
      }),
      "account creation",
    );
    user = data.user;
  }

  if (!user?.id) {
    throw new LocalAuthError("Local manager creation returned no account.");
  }

  await ensureFixture(admin, "organizations", "id", localFixture.organization);
  await ensureFixture(admin, "worksites", "id", localFixture.worksite);
  await ensureFixture(admin, "profiles", "user_id", {
    display_name: localFixture.displayName,
    locale: "nl-BE",
    user_id: user.id,
  });
  await ensureFixture(admin, "memberships", "id", {
    employee_code: null,
    id: localFixture.membershipId,
    organization_id: localFixture.organization.id,
    role: "manager",
    status: "active",
    user_id: user.id,
  });

  return { organizationId: localFixture.organization.id, userId: user.id };
}

export async function main(args = process.argv.slice(2)) {
  validateBootstrapArguments(args);
  loadLocalEnvironment();
  // Reject hosted configuration before invoking any command or making any request.
  requireLocalOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const credentials = {
    email: requireFictionalEmail(process.env.CLOXA_LOCAL_MANAGER_EMAIL),
    password: requireLocalPassword(
      process.env.CLOXA_LOCAL_MANAGER_PASSWORD,
      "CLOXA_LOCAL_MANAGER_PASSWORD",
    ),
  };
  const settings = validateLocalStack(process.env, getLocalStackStatus());
  const requireFromWeb = createRequire(
    path.join(projectRoot, "apps", "web", "package.json"),
  );
  const { createClient } = requireFromWeb("@supabase/supabase-js");
  const admin = createClient(settings.supabaseUrl, settings.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: localOnlyFetch },
  });

  await bootstrapManager(admin, credentials);
  console.log(
    "Fictional local manager, organization, worksite and membership are ready. Existing passwords are unchanged.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof LocalAuthError
        ? error.message
        : "Local bootstrap failed. No credentials were logged.",
    );
    process.exitCode = 1;
  });
}
