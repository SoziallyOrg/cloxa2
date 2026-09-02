import { describe, expect, it, vi } from "vitest";

import {
  assertFixtureMatches,
  bootstrapManager,
  localFixture,
} from "../scripts/local-auth-bootstrap.mjs";
import {
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
  validateBootstrapArguments,
  validateLocalStack,
} from "../scripts/local-auth-config.mjs";

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
  SUPABASE_SECRET_KEY: "fixture-server-key",
};
const status = {
  API_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
  PUBLISHABLE_KEY: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SECRET_KEY: environment.SUPABASE_SECRET_KEY,
};

describe("controlled local bootstrap boundaries", () => {
  it.each([
    "http://localhost:54321",
    "http://localhost:54321/",
    "http://127.0.0.1:54321",
    "http://127.0.0.1:54321/",
    "http://[::1]:54321",
    "https://127.0.0.1:54321",
  ])("accepts explicit canonical loopback origin %s", (value) => {
    expect(requireLocalOrigin(value)).toBe(new URL(value).origin);
  });

  it.each([
    "https://project.supabase.co",
    "https://localhost.supabase.co",
    "http://127.0.0.1.evil.test",
    "http://127.1:54321",
    "http://2130706433:54321",
    "http://0x7f000001:54321",
    "http://0.0.0.0:54321",
    "http://192.168.1.1:54321",
    "http://localhost.:54321",
    "http://LOCALHOST:54321",
    "http://user@localhost:54321",
    "http://user:password@127.0.0.1:54321",
    "http://localhost:54321/path",
    "http://localhost:54321/?x=1",
    "http://localhost:54321/#fragment",
    "http://localhost:54321?",
    "http://localhost:54321#",
    "http://localhost:54321/../",
    "http://localhost:54321\\",
    " http://localhost:54321",
    "http://localhost:54321\n",
    "file:///localhost",
    "not-a-url",
    "",
    undefined,
  ])("rejects hosted or ambiguous URL %s", (value) => {
    expect(() => requireLocalOrigin(value)).toThrow();
  });

  it("requires exactly the explicit confirmation flag", () => {
    expect(() =>
      validateBootstrapArguments(["--confirm-local-development"]),
    ).not.toThrow();

    for (const args of [
      [],
      ["--yes"],
      ["--confirm-local-development=true"],
      ["--confirm-local-development", "--hosted"],
    ]) {
      expect(() => validateBootstrapArguments(args)).toThrow();
    }
  });

  it("requires local keys and endpoint to match the repository's running stack", () => {
    expect(validateLocalStack(environment, status)).toMatchObject({
      supabaseUrl: status.API_URL,
    });
    expect(
      validateLocalStack(
        { ...environment, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
        status,
      ).supabaseUrl,
    ).toBe(status.API_URL);
    expect(() =>
      validateLocalStack(
        { ...environment, SUPABASE_SECRET_KEY: "another-server-key" },
        status,
      ),
    ).toThrow();
    expect(() =>
      validateLocalStack(
        { ...environment, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "another-public-key" },
        status,
      ),
    ).toThrow();
    expect(() =>
      validateLocalStack(
        { ...environment, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54322" },
        status,
      ),
    ).toThrow();
    expect(() =>
      validateLocalStack(environment, {
        ...status,
        API_URL: "https://hosted.supabase.co",
      }),
    ).toThrow();
    expect(() =>
      validateLocalStack(environment, { ...status, API_URL: "http://localhost:54321" }),
    ).toThrow();
  });

  it("accepts current and legacy local CLI key names", () => {
    expect(
      validateLocalStack(environment, {
        API_URL: status.API_URL,
        ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        SERVICE_ROLE_KEY: environment.SUPABASE_SECRET_KEY,
      }),
    ).toMatchObject({ supabaseUrl: status.API_URL });
  });

  it("requires fictional email and normalizes it", () => {
    expect(requireFictionalEmail("  Manager@Example.Test  ")).toBe(
      "manager@example.test",
    );

    for (const email of [
      "manager@gmail.com",
      "manager@example.com",
      "manager@example.test.evil",
      "manager@localhost",
      "missing",
      "",
      undefined,
    ]) {
      expect(() => requireFictionalEmail(email)).toThrow();
    }
  });

  it("requires non-logged credentials from the environment", () => {
    for (const password of [undefined, "", "short", "x".repeat(129)]) {
      expect(() =>
        requireLocalPassword(password, "CLOXA_LOCAL_MANAGER_PASSWORD"),
      ).toThrow();
    }

    expect(requireLocalPassword(" x ".repeat(4), "CLOXA_LOCAL_MANAGER_PASSWORD")).toBe(
      " x ".repeat(4),
    );
  });

  it("reports conflicts without including existing or supplied values", () => {
    expect(() =>
      assertFixtureMatches(
        { name: "private existing value" },
        { name: "private supplied value" },
        "organization",
      ),
    ).toThrow(
      "Local organization conflicts with an existing record. No overwrite performed.",
    );
  });
});

type Row = Record<string, unknown>;
type FixtureUser = {
  id: string;
  email: string;
  email_confirmed_at: string;
  app_metadata: { cloxa_local_fixture: string };
};

function createFakeAdmin() {
  const users: FixtureUser[] = [];
  const tables = new Map<string, Row[]>();
  const writes: string[] = [];
  const createUser = vi.fn(
    async (input: { email: string; app_metadata: { cloxa_local_fixture: string } }) => {
      const user = {
        ...input,
        id: "81000000-0000-4000-8000-000000000001",
        email_confirmed_at: "2026-09-02T00:00:00Z",
      };
      users.push(user);
      return { data: { user }, error: null };
    },
  );
  const admin = {
    auth: {
      admin: {
        createUser,
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const matches = () =>
        (tables.get(table) ?? []).filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        );
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        async maybeSingle() {
          return { data: matches()[0] ?? null, error: null };
        },
        then(resolve: (result: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: matches(), error: null }));
        },
        async upsert(row: Row, options: { onConflict: string }) {
          const rows = tables.get(table) ?? [];

          if (
            !rows.some(
              (existing) => existing[options.onConflict] === row[options.onConflict],
            )
          ) {
            rows.push({ ...row });
            tables.set(table, rows);
            writes.push(table);
          }

          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  return { admin, createUser, tables, users, writes };
}

describe("local manager bootstrap idempotency", () => {
  const credentials = {
    email: "fixture.manager@example.test",
    password: "fictional-test-password",
  };

  it("creates one confirmed manager and exactly one matching fixture set", async () => {
    const fake = createFakeAdmin();
    await bootstrapManager(fake.admin, credentials);
    await bootstrapManager(fake.admin, credentials);

    expect(fake.createUser).toHaveBeenCalledTimes(1);
    expect(fake.createUser.mock.calls[0]?.[0]).toMatchObject({ email_confirm: true });
    expect(fake.users).toHaveLength(1);
    expect(fake.writes).toEqual([
      "organizations",
      "worksites",
      "profiles",
      "memberships",
    ]);
    expect(fake.tables.get("worksites")).toEqual([localFixture.worksite]);
    expect(fake.tables.get("memberships")).toEqual([
      expect.objectContaining({
        role: "manager",
        status: "active",
        user_id: fake.users[0]!.id,
      }),
    ]);
  });

  it("refuses an unrelated account without issuing any writes", async () => {
    const fake = createFakeAdmin();
    fake.users.push({
      id: "81000000-0000-4000-8000-000000000001",
      email: credentials.email,
      email_confirmed_at: "2026-09-02T00:00:00Z",
      app_metadata: { cloxa_local_fixture: "unrelated" },
    });

    await expect(bootstrapManager(fake.admin, credentials)).rejects.toThrow(
      "Existing account is not this confirmed local manager fixture.",
    );
    expect(fake.writes).toEqual([]);
    expect(fake.createUser).not.toHaveBeenCalled();
  });

  it("refuses an existing conflicting organization before creating an Auth user", async () => {
    const fake = createFakeAdmin();
    fake.tables.set("organizations", [
      { ...localFixture.organization, name: "Unrelated organization" },
    ]);

    await expect(bootstrapManager(fake.admin, credentials)).rejects.toThrow(
      "No overwrite performed.",
    );
    expect(fake.writes).toEqual([]);
    expect(fake.createUser).not.toHaveBeenCalled();
  });

  it("does not reactivate an intentionally inactive manager on rerun", async () => {
    const fake = createFakeAdmin();
    await bootstrapManager(fake.admin, credentials);
    fake.tables.get("memberships")![0]!.status = "inactive";

    await expect(bootstrapManager(fake.admin, credentials)).rejects.toThrow(
      "No overwrite performed.",
    );
    expect(fake.tables.get("memberships")![0]!.status).toBe("inactive");
    expect(fake.createUser).toHaveBeenCalledTimes(1);
  });

  it("refuses a reserved membership ID conflict before creating an Auth user", async () => {
    const fake = createFakeAdmin();
    fake.tables.set("memberships", [
      { id: localFixture.membershipId, user_id: "unrelated" },
    ]);

    await expect(bootstrapManager(fake.admin, credentials)).rejects.toThrow(
      "Local membership ID belongs to another account. No overwrite performed.",
    );
    expect(fake.createUser).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("refuses silently adding an organization to a multi-membership account", async () => {
    const fake = createFakeAdmin();
    await bootstrapManager(fake.admin, credentials);
    fake.tables.get("memberships")!.push({
      id: "unrelated",
      organization_id: "unrelated",
      user_id: fake.users[0]!.id,
    });

    await expect(bootstrapManager(fake.admin, credentials)).rejects.toThrow(
      "Local manager has another membership. No overwrite performed.",
    );
    expect(fake.createUser).toHaveBeenCalledTimes(1);
  });
});
