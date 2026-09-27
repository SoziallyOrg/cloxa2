import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import {
  assertFixtureUserOwnership,
  buildLocalAuthCleanupSql,
  claimLocalAuthEmployee,
  cleanupLocalAuthE2eLease,
  createLocalAuthE2eLease,
  createLocalAuthE2eOperation,
  createLocalAuthFixtureFetch,
  createLocalAuthFixtureDatabase,
  createSupabaseFixtureStore,
  localAuthE2eFixtureMarker,
} from "../scripts/local-auth-e2e-fixture.mjs";

const ids = {
  break: "91000000-0000-4000-8000-000000000012",
  breakOperation: "91000000-0000-4000-8000-000000000014",
  clockRequest: "91000000-0000-4000-8000-000000000013",
  employee: "91000000-0000-4000-8000-000000000006",
  employeeMembership: "91000000-0000-4000-8000-000000000010",
  entry: "91000000-0000-4000-8000-000000000011",
  invitation: "91000000-0000-4000-8000-000000000007",
  manager: "91000000-0000-4000-8000-000000000005",
  membership: "91000000-0000-4000-8000-000000000004",
  organization: "91000000-0000-4000-8000-000000000003",
  proof: "91000000-0000-4000-8000-000000000002",
  run: "91000000-0000-4000-8000-000000000001",
  worksite: "91000000-0000-4000-8000-000000000008",
};
const startedAt = "2026-09-05T12:00:00.000Z";
const createdAt = "2026-09-05T12:00:01.000Z";

function fixtureLease() {
  const values = [ids.run, ids.proof, ids.organization, ids.worksite, ids.membership];
  return createLocalAuthE2eLease({
    createId: () => values.shift()!,
    now: () => new Date(startedAt),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function metadata(lease: ReturnType<typeof fixtureLease>, role: string) {
  return {
    cloxa_local_fixture: localAuthE2eFixtureMarker,
    cloxa_local_fixture_organization_id: lease.organization.id,
    cloxa_local_fixture_proof: lease.proof,
    cloxa_local_fixture_role: role,
    cloxa_local_fixture_run_id: lease.runId,
  };
}

function managerUser(lease: ReturnType<typeof fixtureLease>) {
  return {
    app_metadata: metadata(lease, "manager"),
    created_at: createdAt,
    email: lease.manager.email,
    email_confirmed_at: createdAt,
    id: ids.manager,
  };
}

function employeeUser(lease: ReturnType<typeof fixtureLease>) {
  return {
    app_metadata: metadata(lease, "employee"),
    created_at: createdAt,
    email: lease.employee.email,
    id: ids.employee,
    invited_at: createdAt,
  };
}

function ownManager(lease: ReturnType<typeof fixtureLease>) {
  lease.manager.state = "owned";
  lease.manager.userId = ids.manager;
  return lease;
}

function ownEmployee(lease: ReturnType<typeof fixtureLease>) {
  lease.employee.emailAbsent = true;
  lease.employee.invitationAttempted = true;
  lease.employee.invitationId = ids.invitation;
  lease.employee.state = "owned";
  lease.employee.userId = ids.employee;
  return lease;
}

function cleanupDependencies(
  lease: ReturnType<typeof fixtureLease>,
  options: { databaseFailure?: boolean; employeeDeleteFailure?: boolean } = {},
) {
  const getUser = vi.fn(async (userId: string) =>
    userId === ids.employee ? employeeUser(lease) : managerUser(lease),
  );
  const deleteUser = vi.fn(async (userId: string) => {
    if (options.employeeDeleteFailure && userId === ids.employee) {
      throw new Error("private provider failure");
    }
  });
  const cleanup = options.databaseFailure
    ? vi.fn(async () => {
        throw new Error("private database failure");
      })
    : vi.fn(async () => ({ status: "database_cleaned" }));
  return {
    database: { cleanup },
    store: { deleteUser, getUser },
  };
}

function scalarGuardQuery(sql: string, table: "invitations" | "memberships") {
  const match = new RegExp(
    `if exists \\(\\s*(select 1 from public\\.${table}\\b.*?)\\n  \\)`,
    "su",
  ).exec(sql);
  if (!match?.[1]) throw new Error(`Missing ${table} scalar ownership guard.`);
  return match[1]
    .replaceAll(/::(?:uuid|timestamptz)\b/gu, "")
    .replaceAll(/\bemployee_user\b/gu, `'${ids.employee}'`);
}

function scalarGuardDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`attach database ':memory:' as public;
    create table public.invitations (
      id text, organization_id text, normalized_email text, invited_by text,
      intended_role text, status text, display_name text, employee_code text,
      created_at text, accepted_by text
    );
    create table public.memberships (
      id text, organization_id text, user_id text, role text, status text,
      employee_code text, created_at text
    );`);
  return database;
}

function generatedCleanupSql() {
  return buildLocalAuthCleanupSql(ownEmployee(ownManager(fixtureLease())));
}

type ClockGraphTable =
  | "private.time_break_operations"
  | "private.time_clock_requests"
  | "public.time_breaks"
  | "public.time_entries";

function clockGraphGuardQuery(sql: string, table: ClockGraphTable) {
  const marker = `if exists (\n    select 1 from ${table}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${table} ownership guard.`);
  const bodyStart = start + "if exists (\n    ".length;
  const end = sql.indexOf("\n  ) then", bodyStart);
  if (end < 0) throw new Error(`Incomplete ${table} ownership guard.`);
  return sql
    .slice(bodyStart, end)
    .replaceAll(/::(?:text|timestamptz|uuid)\b/gu, "")
    .replaceAll(/\bemployee_membership\b/gu, `'${ids.employeeMembership}'`);
}

function clockGraphDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`attach database ':memory:' as public;
    attach database ':memory:' as private;
    create table public.time_entries (
      id text, organization_id text, membership_id text, worksite_id text,
      origin text, last_correction_request_id text, created_at text
    );
    create table public.time_breaks (
      id text, organization_id text, time_entry_id text,
      employee_membership_id text, worksite_id text, origin text, created_at text
    );
    create table private.time_clock_requests (
      request_id text, membership_id text, operation text, result_code text,
      time_entry_id text, worksite_id text, started_at text, ended_at text,
      processed_at text
    );
    create table private.time_break_operations (
      request_id text, organization_id text, employee_membership_id text,
      processed_at text, result text
    );
    insert into public.time_entries values (
      '${ids.entry}', '${ids.organization}', '${ids.employeeMembership}',
      '${ids.worksite}', 'clock', null, '${createdAt}'
    );
    insert into public.time_breaks values (
      '${ids.break}', '${ids.organization}', '${ids.entry}',
      '${ids.employeeMembership}', '${ids.worksite}', 'live', '${createdAt}'
    );
    insert into private.time_clock_requests values (
      '${ids.clockRequest}', '${ids.employeeMembership}', 'clock_out', 'stopped',
      '${ids.entry}', '${ids.worksite}', '${createdAt}', '${createdAt}', '${createdAt}'
    );
    insert into private.time_break_operations values (
      '${ids.breakOperation}', '${ids.organization}', '${ids.employeeMembership}',
      '${createdAt}',
      '{"request_id":"${ids.breakOperation}","time_entry_id":"${ids.entry}","break_id":"${ids.break}"}'
    );`);
  return database;
}

describe("local Auth E2E ownership", () => {
  it("creates separate per-run identities and an independent ownership proof", () => {
    const lease = fixtureLease();

    expect(lease.runId).not.toBe(lease.proof);
    expect(lease.manager.email).not.toBe(lease.employee.email);
    expect(lease.manager.email).toContain(lease.runId);
    expect(lease.employee.email).toContain(lease.runId);
    expect(lease.marker).toBe(localAuthE2eFixtureMarker);
    expect(lease.marker).not.toBe("cloxa-local-manager-v1");
  });

  it("rejects retained, marker-only and wrong-run users", () => {
    const lease = ownManager(fixtureLease());
    const expected = managerUser(lease);

    expect(() =>
      assertFixtureUserOwnership(
        {
          ...expected,
          app_metadata: { cloxa_local_fixture: "cloxa-local-manager-v1" },
        },
        lease,
        "manager",
        ids.manager,
      ),
    ).toThrow("ownership could not be proven");
    expect(() =>
      assertFixtureUserOwnership(
        {
          ...expected,
          app_metadata: { cloxa_local_fixture: localAuthE2eFixtureMarker },
        },
        lease,
        "manager",
        ids.manager,
      ),
    ).toThrow("ownership could not be proven");
    expect(() =>
      assertFixtureUserOwnership(
        {
          ...expected,
          app_metadata: {
            ...expected.app_metadata,
            cloxa_local_fixture_run_id: "92000000-0000-4000-8000-000000000001",
          },
        },
        lease,
        "manager",
        ids.manager,
      ),
    ).toThrow("ownership could not be proven");
  });

  it("refuses unknown ownership before database or Auth mutation", async () => {
    const lease = ownManager(fixtureLease());
    const dependencies = cleanupDependencies(lease);
    dependencies.store.getUser.mockResolvedValue({
      ...managerUser(lease),
      app_metadata: {
        ...managerUser(lease).app_metadata,
        cloxa_local_fixture_proof: "92000000-0000-4000-8000-000000000002",
      },
    });

    await expect(cleanupLocalAuthE2eLease(lease, dependencies)).resolves.toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(dependencies.database.cleanup).not.toHaveBeenCalled();
    expect(dependencies.store.deleteUser).not.toHaveBeenCalled();
  });

  it("preserves all resources when an attempted invitation is not claimed", async () => {
    const lease = ownManager(fixtureLease());
    lease.employee.emailAbsent = true;
    lease.employee.invitationAttempted = true;
    const dependencies = cleanupDependencies(lease);

    await expect(cleanupLocalAuthE2eLease(lease, dependencies)).resolves.toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(dependencies.database.cleanup).not.toHaveBeenCalled();
    expect(dependencies.store.deleteUser).not.toHaveBeenCalled();
  });

  it("cleans a proven manager after partial setup without targeting planned rows", async () => {
    const lease = ownManager(fixtureLease());
    const dependencies = cleanupDependencies(lease);

    await expect(cleanupLocalAuthE2eLease(lease, dependencies)).resolves.toEqual({
      remaining: [],
      status: "cleaned",
    });
    expect(dependencies.database.cleanup).toHaveBeenCalledOnce();
    expect(dependencies.store.deleteUser).toHaveBeenCalledExactlyOnceWith(ids.manager);
  });

  it("stops after interrupted database cleanup and performs no Auth deletion", async () => {
    const lease = ownManager(fixtureLease());
    const dependencies = cleanupDependencies(lease, { databaseFailure: true });

    const report = await cleanupLocalAuthE2eLease(lease, dependencies);
    expect(report).toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(dependencies.store.deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain(lease.manager.email);
    expect(JSON.stringify(report)).not.toContain(lease.proof);
  });

  it("stops after interrupted Auth cleanup and returns only sanitized labels", async () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const dependencies = cleanupDependencies(lease, {
      employeeDeleteFailure: true,
    });

    const report = await cleanupLocalAuthE2eLease(lease, dependencies);
    expect(report).toEqual({
      remaining: ["manager_auth", "unverified_employee"],
      status: "partial",
    });
    expect(dependencies.store.deleteUser).toHaveBeenCalledExactlyOnceWith(ids.employee);
    expect(JSON.stringify(report)).not.toContain(lease.employee.email);
    expect(JSON.stringify(report)).not.toContain(ids.employee);
  });

  it("stops before ownership reads when the lease operation is cancelled", async () => {
    const lease = ownManager(fixtureLease());
    const dependencies = cleanupDependencies(lease);
    const operation = createLocalAuthE2eOperation(lease);
    operation.abort();

    await expect(cleanupLocalAuthE2eLease(lease, dependencies)).resolves.toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(dependencies.store.getUser).not.toHaveBeenCalled();
    expect(dependencies.database.cleanup).not.toHaveBeenCalled();
    expect(dependencies.store.deleteUser).not.toHaveBeenCalled();
  });

  it("does not start cleanup mutations after a late ownership read resolves", async () => {
    const lease = ownManager(fixtureLease());
    const ownershipRead = deferred<ReturnType<typeof managerUser>>();
    const dependencies = cleanupDependencies(lease);
    dependencies.store.getUser.mockImplementationOnce(() => ownershipRead.promise);
    const operation = createLocalAuthE2eOperation(lease);
    const cleanup = cleanupLocalAuthE2eLease(lease, dependencies);

    await vi.waitFor(() => expect(dependencies.store.getUser).toHaveBeenCalledOnce());
    operation.abort();
    ownershipRead.resolve(managerUser(lease));

    await expect(cleanup).resolves.toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(dependencies.database.cleanup).not.toHaveBeenCalled();
    expect(dependencies.store.deleteUser).not.toHaveBeenCalled();
  });

  it("reports an already-dispatched Auth deletion as uncertain after cancellation", async () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const deletion = deferred<void>();
    const dependencies = cleanupDependencies(lease);
    dependencies.store.deleteUser.mockImplementationOnce(() => deletion.promise);
    const operation = createLocalAuthE2eOperation(lease);
    const cleanup = cleanupLocalAuthE2eLease(lease, dependencies);

    await vi.waitFor(() =>
      expect(dependencies.store.deleteUser).toHaveBeenCalledExactlyOnceWith(
        ids.employee,
      ),
    );
    operation.abort();
    deletion.resolve();

    await expect(cleanup).resolves.toEqual({
      remaining: ["manager_auth", "unverified_employee"],
      status: "partial",
    });
    expect(dependencies.store.deleteUser).toHaveBeenCalledOnce();
  });

  it("preserves the manager when cancellation follows employee cleanup", async () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const managerRead = deferred<ReturnType<typeof managerUser>>();
    const dependencies = cleanupDependencies(lease);
    let managerReads = 0;
    dependencies.store.getUser.mockImplementation((userId: string) => {
      if (userId === ids.employee) return Promise.resolve(employeeUser(lease));
      managerReads += 1;
      return managerReads === 2
        ? managerRead.promise
        : Promise.resolve(managerUser(lease));
    });
    const operation = createLocalAuthE2eOperation(lease);
    const cleanup = cleanupLocalAuthE2eLease(lease, dependencies);

    await vi.waitFor(() => {
      expect(dependencies.store.deleteUser).toHaveBeenCalledExactlyOnceWith(
        ids.employee,
      );
      expect(managerReads).toBe(2);
    });
    operation.abort();
    managerRead.resolve(managerUser(lease));

    await expect(cleanup).resolves.toEqual({
      remaining: ["manager_auth"],
      status: "partial",
    });
    expect(dependencies.store.deleteUser).toHaveBeenCalledOnce();
  });

  it("aborts pending fixture fetches and releases request deadline hooks", async () => {
    const controller = new AbortController();
    const clearTimer = vi.fn(clearTimeout);
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let requestSignal: AbortSignal | undefined;
    const fetchImplementation = vi.fn((_input: unknown, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new Error("synthetic request abort")),
          { once: true },
        );
      });
    });
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation,
      requestTimeoutMs: 1_000,
      signal: controller.signal,
    });
    const pending = fixtureFetch("http://127.0.0.1:54321/auth/v1/admin/users");

    controller.abort();

    await expect(pending).rejects.toThrow("synthetic request abort");
    expect(requestSignal?.aborted).toBe(true);
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalled();
  });

  it("rejects a late Auth Admin ownership read after operation cancellation", async () => {
    const controller = new AbortController();
    const read = deferred<{
      data: { user: ReturnType<typeof managerUser> };
      error: null;
    }>();
    const getUserById = vi.fn(() => read.promise);
    const store = createSupabaseFixtureStore(
      {
        auth: { admin: { getUserById } },
        from: vi.fn(),
      },
      { signal: controller.signal },
    );
    const pending = store.getUser(ids.manager);

    controller.abort();
    read.resolve({ data: { user: managerUser(fixtureLease()) }, error: null });

    await expect(pending).rejects.toThrow("operation was cancelled");
  });
});

describe("local Auth fixture response lifecycle", () => {
  it("does not dispatch a request from an already-aborted source", async () => {
    const controller = new AbortController();
    controller.abort();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const clearTimer = vi.fn();
    const fetchImplementation = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation,
      setTimer: vi.fn(() => 1),
      signal: controller.signal,
    });

    await expect(
      fixtureFetch("http://127.0.0.1:54321/auth/v1/admin/users"),
    ).rejects.toThrow("operation was cancelled");
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(addListener).not.toHaveBeenCalled();
    expect(removeListener).not.toHaveBeenCalled();
  });

  it("keeps operation abort connected through a stalled Auth response body", async () => {
    const lease = ownManager(fixtureLease());
    const operation = createLocalAuthE2eOperation(lease);
    const headersSeen = deferred<void>();
    const cancelBody = vi.fn();
    let requestSignal: AbortSignal | undefined;
    const fixtureFetch = createLocalAuthFixtureFetch({
      fetchImplementation: vi.fn(async (_input: unknown, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        headersSeen.resolve();
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelBody,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
      requestTimeoutMs: 1_000,
      signal: operation.signal,
    });
    const deleteUser = vi.fn();
    const databaseCleanup = vi.fn();
    const store = createSupabaseFixtureStore(
      {
        auth: {
          admin: {
            async getUserById() {
              const response = await fixtureFetch(
                "http://127.0.0.1:54321/auth/v1/admin/users/example",
              );
              return { data: { user: await response.json() }, error: null };
            },
            deleteUser,
          },
        },
        from: vi.fn(),
      },
      { signal: operation.signal },
    );
    const cleanup = cleanupLocalAuthE2eLease(lease, {
      database: { cleanup: databaseCleanup },
      signal: operation.signal,
      store,
    });

    await headersSeen.promise;
    operation.abort();

    await expect(cleanup).resolves.toEqual({
      remaining: ["application_data", "manager_auth"],
      status: "preserved",
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(databaseCleanup).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(lease.manager.state).toBe("owned");
  });

  it("keeps a stalled dispatched deletion uncertain and starts no next deletion", async () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const operation = createLocalAuthE2eOperation(lease);
    const deletionHeadersSeen = deferred<void>();
    const cancelBody = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: cancelBody,
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
      ),
      requestTimeoutMs: 1_000,
      signal: operation.signal,
    });
    const deleteUser = vi.fn(async () => {
      const response = await fixtureFetch(
        "http://127.0.0.1:54321/auth/v1/admin/users/example",
      );
      deletionHeadersSeen.resolve();
      await response.json();
      return { data: {}, error: null };
    });
    const store = createSupabaseFixtureStore(
      {
        auth: {
          admin: {
            deleteUser,
            getUserById: vi.fn(async (userId: string) => ({
              data: {
                user:
                  userId === ids.employee ? employeeUser(lease) : managerUser(lease),
              },
              error: null,
            })),
          },
        },
        from: vi.fn(),
      },
      { signal: operation.signal },
    );
    const cleanup = cleanupLocalAuthE2eLease(lease, {
      database: { cleanup: vi.fn(async () => ({ status: "database_cleaned" })) },
      signal: operation.signal,
      store,
    });

    await deletionHeadersSeen.promise;
    expect(lease.employee.state).toBe("uncertain");
    operation.abort();

    await expect(cleanup).resolves.toEqual({
      remaining: ["manager_auth", "unverified_employee"],
      status: "partial",
    });
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(lease.manager.state).toBe("owned");
  });

  it("keeps the request deadline active through a stalled response body", async () => {
    let fireDeadline!: () => void;
    let requestSignal: AbortSignal | undefined;
    const cancelBody = vi.fn();
    const clearTimer = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation: vi.fn(async (_input: unknown, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelBody,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
      requestTimeoutMs: 25,
      setTimer: vi.fn((callback: () => void) => {
        fireDeadline = callback;
        return 1;
      }),
    });
    const response = await fixtureFetch("http://127.0.0.1:54321/rest/v1/profiles");
    const body = response.json();

    fireDeadline();

    await expect(body).rejects.toThrow();
    await vi.waitFor(() => expect(clearTimer).toHaveBeenCalledExactlyOnceWith(1));
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelBody).toHaveBeenCalledOnce();
  });

  it("preserves completed JSON status, headers, and cloneable body semantics", async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const clearTimer = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation: vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "ok" }), {
            headers: {
              "content-type": "application/json",
              "x-fixture-proof": "present",
            },
            status: 202,
            statusText: "Accepted",
          }),
      ),
      setTimer: vi.fn(() => 7),
      signal: controller.signal,
    });

    const response = await fixtureFetch("http://127.0.0.1:54321/auth/v1/admin/users");
    const clone = response.clone();

    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("x-fixture-proof")).toBe("present");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    await expect(clone.json()).resolves.toEqual({ status: "ok" });
    await vi.waitFor(() => expect(clearTimer).toHaveBeenCalledExactlyOnceWith(7));
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("releases request hooks when the response body fails", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const clearTimer = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                stream.error(new Error("synthetic body failure"));
              },
            }),
            { status: 200 },
          ),
      ),
      setTimer: vi.fn(() => 11),
      signal: controller.signal,
    });
    const response = await fixtureFetch("http://127.0.0.1:54321/rest/v1/profiles");

    await expect(response.text()).rejects.toThrow("synthetic body failure");
    await vi.waitFor(() => expect(clearTimer).toHaveBeenCalledExactlyOnceWith(11));
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("cancels the source and releases hooks when the response consumer cancels", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const cancelBody = vi.fn();
    const clearTimer = vi.fn();
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: cancelBody,
            }),
            { status: 200 },
          ),
      ),
      setTimer: vi.fn(() => 13),
      signal: controller.signal,
    });
    const response = await fixtureFetch("http://127.0.0.1:54321/rest/v1/profiles");

    await response.body!.cancel("synthetic consumer cancellation");

    await vi.waitFor(() => expect(cancelBody).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(clearTimer).toHaveBeenCalledExactlyOnceWith(13));
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("releases request hooks immediately for a no-body response", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const clearTimer = vi.fn();
    const original = new Response(null, {
      headers: { "x-fixture-proof": "present" },
      status: 204,
    });
    const fixtureFetch = createLocalAuthFixtureFetch({
      clearTimer,
      fetchImplementation: vi.fn(async () => original),
      setTimer: vi.fn(() => 17),
      signal: controller.signal,
    });

    const response = await fixtureFetch("http://127.0.0.1:54321/auth/v1/admin/users");

    expect(response).toBe(original);
    expect(response.status).toBe(204);
    expect(response.headers.get("x-fixture-proof")).toBe("present");
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith(17);
    expect(removeListener).toHaveBeenCalledOnce();
  });
});

describe("local Auth employee ownership claim", () => {
  function invitation(lease: ReturnType<typeof fixtureLease>) {
    return {
      accepted_by: null,
      created_at: createdAt,
      display_name: lease.employee.displayName,
      employee_code: lease.employee.code,
      id: ids.invitation,
      intended_role: "employee",
      invited_by: ids.manager,
      normalized_email: lease.employee.email,
      organization_id: lease.organization.id,
      status: "pending",
    };
  }

  function claimStore(
    lease: ReturnType<typeof fixtureLease>,
    invite = invitation(lease),
  ) {
    const candidate = {
      ...employeeUser(lease),
      app_metadata: { provider: "email", providers: ["email"] },
    };
    const claimed = employeeUser(lease);
    return {
      findUsersByEmail: vi.fn(async () => [candidate]),
      getUser: vi.fn(async (userId: string) =>
        userId === ids.manager ? managerUser(lease) : claimed,
      ),
      readRows: vi.fn(async (table: string) => {
        if (table === "invitations") return [invite];
        return [];
      }),
      updateUser: vi.fn(async () => claimed),
    };
  }

  it("refuses a wrong inviter before stamping employee app metadata", async () => {
    const lease = ownManager(fixtureLease());
    lease.managerMembership.state = "owned";
    lease.employee.emailAbsent = true;
    lease.employee.invitationAttempted = true;
    const store = claimStore(lease, {
      ...invitation(lease),
      invited_by: "92000000-0000-4000-8000-000000000003",
    });

    await expect(claimLocalAuthEmployee(lease, { store })).rejects.toThrow(
      "ownership could not be proven",
    );
    expect(store.updateUser).not.toHaveBeenCalled();
    expect(lease.employee.state).toBe("planned");
  });

  it("claims only the exact newly invited user with server-owned metadata", async () => {
    const lease = ownManager(fixtureLease());
    lease.managerMembership.state = "owned";
    lease.employee.emailAbsent = true;
    lease.employee.invitationAttempted = true;
    const store = claimStore(lease);

    await claimLocalAuthEmployee(lease, { store });

    expect(store.updateUser).toHaveBeenCalledWith(ids.employee, {
      app_metadata: expect.objectContaining({
        cloxa_local_fixture: localAuthE2eFixtureMarker,
        cloxa_local_fixture_proof: lease.proof,
        cloxa_local_fixture_run_id: lease.runId,
      }),
    });
    expect(lease.employee).toMatchObject({
      invitationId: ids.invitation,
      state: "owned",
      userId: ids.employee,
    });
  });
});

describe("local Auth cleanup command boundary", () => {
  it("builds an exact graph guard and never sweeps by email or factor list", () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const sql = buildLocalAuthCleanupSql(lease);

    expect(sql).toContain("cloxa_local_fixture_proof");
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("local_auth_fixture_ownership_unverified");
    expect(sql).toContain("audit_event.actor_user_id = any(fixture_users)");
    expect(sql).toContain(ids.manager);
    expect(sql).toContain(ids.employee);
    expect(sql).not.toMatch(/like\s+['"]%/iu);
    expect(sql).not.toContain("delete from auth.mfa_factors");
    expect(sql).not.toContain("is distinct from all");
  });

  it("rejects null and unrelated invitation ownership while accepting exact rows", () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const query = scalarGuardQuery(buildLocalAuthCleanupSql(lease), "invitations");
    const row = [
      lease.employee.invitationId,
      lease.organization.id,
      lease.employee.email,
      lease.manager.userId,
      "employee",
      "accepted",
      lease.employee.displayName,
      lease.employee.code,
      createdAt,
      lease.employee.userId,
    ];

    for (const [label, values, mismatches] of [
      ["exact", row, 0],
      ["null display name and code", row.with(6, null).with(7, null), 1],
      ["unrelated inviter", row.with(3, "92000000-0000-4000-8000-000000000003"), 1],
    ] as const) {
      const database = scalarGuardDatabase();
      try {
        database
          .prepare(
            "insert into public.invitations values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(...values);
        expect(database.prepare(query).all(), label).toHaveLength(mismatches);
      } finally {
        database.close();
      }
    }
  });

  it("rejects null and unrelated membership ownership while accepting exact rows", () => {
    const lease = ownEmployee(ownManager(fixtureLease()));
    const query = scalarGuardQuery(buildLocalAuthCleanupSql(lease), "memberships");
    const row = [
      "91000000-0000-4000-8000-000000000103",
      lease.organization.id,
      lease.employee.userId,
      "employee",
      "active",
      lease.employee.code,
      createdAt,
    ];

    for (const [label, values, mismatches] of [
      ["exact", row, 0],
      ["null employee code", row.with(5, null), 1],
      ["unrelated user", row.with(2, "92000000-0000-4000-8000-000000000004"), 1],
    ] as const) {
      const database = scalarGuardDatabase();
      try {
        database
          .prepare("insert into public.memberships values (?, ?, ?, ?, ?, ?, ?)")
          .run(...values);
        expect(database.prepare(query).all(), label).toHaveLength(mismatches);
      } finally {
        database.close();
      }
    }
  });

  it("accepts only the exact valid clock-only graph", () => {
    const sql = generatedCleanupSql();
    const database = clockGraphDatabase();
    try {
      for (const table of [
        "public.time_entries",
        "public.time_breaks",
        "private.time_clock_requests",
        "private.time_break_operations",
      ] as const) {
        expect(
          database.prepare(clockGraphGuardQuery(sql, table)).all(),
          table,
        ).toHaveLength(0);
      }

      database.exec(`delete from private.time_clock_requests;
        insert into private.time_clock_requests values (
          '${ids.clockRequest}', '${ids.employeeMembership}', 'clock_out',
          'already_stopped', null, '${ids.worksite}', null, null, '${createdAt}'
        );`);
      expect(
        database
          .prepare(clockGraphGuardQuery(sql, "private.time_clock_requests"))
          .all(),
      ).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("refuses a clock entry with the wrong membership", () => {
    const database = clockGraphDatabase();
    try {
      database.exec(
        "update public.time_entries set membership_id = '92000000-0000-4000-8000-000000000010'",
      );
      expect(
        database
          .prepare(clockGraphGuardQuery(generatedCleanupSql(), "public.time_entries"))
          .all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it.each([
    ["entry", "time_entry_id", "92000000-0000-4000-8000-000000000011"],
    ["worksite", "worksite_id", "92000000-0000-4000-8000-000000000008"],
  ])("refuses a break with the wrong %s", (_label, column, value) => {
    const database = clockGraphDatabase();
    try {
      database.exec(`update public.time_breaks set ${column} = '${value}'`);
      expect(
        database
          .prepare(clockGraphGuardQuery(generatedCleanupSql(), "public.time_breaks"))
          .all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it.each([
    ["membership", "membership_id", "92000000-0000-4000-8000-000000000010"],
    ["worksite", "worksite_id", "92000000-0000-4000-8000-000000000008"],
    ["entry", "time_entry_id", "92000000-0000-4000-8000-000000000011"],
  ])("refuses a clock request with the wrong %s", (_label, column, value) => {
    const database = clockGraphDatabase();
    try {
      database.exec(`update private.time_clock_requests set ${column} = '${value}'`);
      expect(
        database
          .prepare(
            clockGraphGuardQuery(generatedCleanupSql(), "private.time_clock_requests"),
          )
          .all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it.each([
    ["organization", "organization_id", "92000000-0000-4000-8000-000000000003"],
    ["membership", "employee_membership_id", "92000000-0000-4000-8000-000000000010"],
  ])("refuses a break operation with the wrong %s", (_label, column, value) => {
    const database = clockGraphDatabase();
    try {
      database.exec(`update private.time_break_operations set ${column} = '${value}'`);
      expect(
        database
          .prepare(
            clockGraphGuardQuery(
              generatedCleanupSql(),
              "private.time_break_operations",
            ),
          )
          .all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("refuses a cross-tenant break that references an owned entry", () => {
    const database = clockGraphDatabase();
    try {
      database.exec(`update public.time_breaks
        set organization_id = '92000000-0000-4000-8000-000000000003',
            employee_membership_id = '92000000-0000-4000-8000-000000000010',
            worksite_id = '92000000-0000-4000-8000-000000000008'`);
      expect(
        database
          .prepare(clockGraphGuardQuery(generatedCleanupSql(), "public.time_breaks"))
          .all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("keeps correction, export, recovery and unknown organization tables fail closed", () => {
    const sql = generatedCleanupSql();
    const guardStart = sql.indexOf(
      "if exists (\n    select 1 from public.audit_events",
    );
    const scanStart = sql.indexOf(
      "where attribute.attname = 'organization_id'",
      guardStart,
    );
    const scanEnd = sql.indexOf("order by namespace.nspname", scanStart);
    const exclusions = sql.slice(scanStart, scanEnd);

    expect(guardStart).toBeGreaterThan(0);
    expect(scanStart).toBeGreaterThan(guardStart);
    expect(exclusions).toContain("'time_entries', 'time_breaks'");
    for (const unsupported of [
      "correction_requests",
      "export_jobs",
      "manager_mfa_recovery_cases",
      "future_organization_records",
    ]) {
      expect(exclusions).not.toContain(`'${unsupported}'`);
    }
  });

  it("locks the complete checked graph before proof and keeps foreign keys active", () => {
    const sql = generatedCleanupSql();
    const firstLock = sql.indexOf("lock table %I.%I in %s mode");
    const firstOwnershipCheck = sql.indexOf("if not exists (");

    expect(firstLock).toBeGreaterThan(0);
    expect(firstLock).toBeLessThan(firstOwnershipCheck);
    expect(sql).toContain("('auth'::name, 'users'::name)");
    expect(sql).toContain("('public'::name, 'audit_events'::name)");
    expect(sql).toContain("('private'::name, 'time_clock_requests'::name)");
    expect(sql).toContain("order by candidate.schema_name, candidate.relation_name");
    expect(sql).toContain("then 'access exclusive' else 'share row exclusive'");
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '20s'");
    expect(sql).toContain("set local idle_in_transaction_session_timeout = '20s'");
    expect(sql).toContain(`where id = '${ids.invitation}'::uuid`);
    expect(sql).not.toContain("session_replication_role");
  });

  it("deletes the proven graph child first and leaves sentinel rows untargeted", () => {
    const sql = generatedCleanupSql();
    const deletes = [
      "delete from private.time_break_operations",
      "delete from private.time_clock_requests",
      "delete from public.time_breaks",
      "delete from public.audit_events",
      "delete from public.invitations",
      "delete from public.time_entries",
      "delete from public.memberships",
      "delete from public.worksites",
      "delete from public.profiles",
      "delete from private.manager_mfa_registrations",
      "delete from public.organizations",
    ];
    const positions = deletes.map((statement) => sql.indexOf(statement));

    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(sql).not.toMatch(/delete from public\.organizations\s*;/u);
    expect(sql).not.toContain("truncate");
  });

  it("uses the exact trigger sequence and verifies restoration before commit", () => {
    const sql = generatedCleanupSql();
    const transitions = [
      "alter table private.time_break_operations disable trigger time_break_operation_immutable;",
      "alter table private.time_clock_requests disable trigger time_clock_operation_immutable;",
      "alter table public.time_breaks disable trigger time_break_history;",
      "alter table public.audit_events disable trigger audit_events_reject_mutation;",
      "alter table public.time_entries disable trigger time_entry_history;",
      "alter table public.time_entries enable trigger time_entry_history;",
      "alter table public.audit_events enable trigger audit_events_reject_mutation;",
      "alter table public.time_breaks enable trigger time_break_history;",
      "alter table private.time_clock_requests enable trigger time_clock_operation_immutable;",
      "alter table private.time_break_operations enable trigger time_break_operation_immutable;",
    ];
    const positions = transitions.map((statement) => sql.indexOf(statement));
    const postcondition = sql.indexOf("do $cloxa_local_auth_fixture_postconditions$");
    const commit = sql.lastIndexOf("commit;");

    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(postcondition).toBeGreaterThan(positions.at(-1)!);
    expect(sql.slice(postcondition, commit)).toContain(
      "select pg_catalog.count(*) = 5 into triggers_ready",
    );
    expect(commit).toBeGreaterThan(postcondition);
    expect(sql.match(/\bcommit;/gu)).toHaveLength(1);
  });

  it("keeps every trigger transition inside the rollback-capable transaction", () => {
    const sql = generatedCleanupSql();
    const begin = sql.indexOf("begin;");
    const commit = sql.lastIndexOf("commit;");
    const transitions = [
      ...sql.matchAll(/alter table .*? (?:disable|enable) trigger .*?;/gu),
    ];

    expect(transitions).toHaveLength(10);
    for (const transition of transitions) {
      expect(transition.index).toBeGreaterThan(begin);
      expect(transition.index).toBeLessThan(commit);
    }
  });

  it("passes the verified Docker endpoint to the pinned operator runner", () => {
    const lease = ownManager(fixtureLease());
    const runSql = vi.fn(() => ({ status: "database_cleaned" }));
    const database = createLocalAuthFixtureDatabase({
      dockerEndpoint: "unix:///var/run/docker.sock",
      dockerEnvironment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
      runSql,
      timeoutMs: 1_500,
    });

    expect(database.cleanup(lease)).toEqual({ status: "database_cleaned" });
    expect(runSql).toHaveBeenCalledWith(
      expect.stringContaining("local_auth_fixture_ownership_unverified"),
      {
        dockerEndpoint: "unix:///var/run/docker.sock",
        environment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
        timeoutMs: 1_500,
      },
    );
  });

  it("selects the intended safe file without importing Playwright configuration", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const [spec, config, packageSource] = await Promise.all([
      readFile(path.join(root, "apps", "web", "e2e", "local-auth.spec.mts"), "utf8"),
      readFile(path.join(root, "playwright.local-auth.config.ts"), "utf8"),
      readFile(path.join(root, "package.json"), "utf8"),
    ]);
    const titles = [...spec.matchAll(/test\("([^"]+)"/gu)].map((match) => match[1]);

    expect(titles).toEqual([
      "volledige lokale uitnodiging, aanmelding en wachtwoordherstel",
      "begrensde native workspace UX",
      "publieke Auth API kan geen account aanmaken",
      "aanmeldfouten onthullen geen accountbestaan",
      "browserbundels bevatten geen serversleutel",
    ]);
    expect(spec).not.toContain("CLOXA_LOCAL_MANAGER_");
    expect(spec).not.toContain("clearLocalManagerMfa");
    expect(spec).not.toContain("execFileSync");
    expect(spec).toContain("createLocalAuthFixtureFetch({ signal: operation.signal })");
    expect(spec).toContain("runSql: runOperatorSqlAsync");
    expect(spec).toContain("timeoutMs: localAuthFixtureDeadlines.sqlMs");
    expect(spec).toContain('record.locator(".record-totals dt")');
    expect(spec).toContain('record.locator(".record-totals dd")');
    expect(spec).toContain('record.locator(".record-exact dt")');
    expect(spec).toContain('record.locator(".record-exact dd")');
    expect(spec).toContain('exactAttributes(exactTimes, "datetime")');
    expect(spec).toContain('item.locator(":scope > p")');
    expect(spec).not.toContain(
      'const compact = await record.locator(".record-totals").innerText()',
    );
    expect(config).toContain("testMatch: /local-auth\\.spec\\.mts/u");
    expect(config).not.toContain("globalSetup");
    expect(packageSource).toContain(
      '"test:e2e:local-auth": "playwright test --config playwright.local-auth.config.ts"',
    );
  });
});
