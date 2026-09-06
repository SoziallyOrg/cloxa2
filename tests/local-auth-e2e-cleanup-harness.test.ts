import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAuthE2eLease } from "../scripts/local-auth-e2e-fixture.mjs";
import {
  buildControlledCleanupSql,
  buildOwnershipRefusalSql,
  buildTriggerRollbackSql,
  createNativeSessionIdentity,
  drainOwnedSessions,
  parsePostgresErrorEvidence,
  runNativeInterleavingScenario,
  runObserverSqlSmokeCheck,
  startBoundedOperatorSql,
} from "./local-auth-e2e-cleanup.postgres.mjs";

const ids = {
  cleanup: 702,
  gate: 701,
  insert: 703,
};

function fixtureLease(offset = 0) {
  const values = [
    `a100000${offset}-0000-4000-8000-000000000001`,
    `a200000${offset}-0000-4000-8000-000000000002`,
    `a300000${offset}-0000-4000-8000-000000000003`,
    `a400000${offset}-0000-4000-8000-000000000004`,
    `a500000${offset}-0000-4000-8000-000000000005`,
  ];
  const lease = createLocalAuthE2eLease({
    createId: () => values.shift(),
    now: () => new Date("2026-09-06T10:00:00.000Z"),
  });
  lease.manager.state = "owned";
  lease.manager.userId = `a600000${offset}-0000-4000-8000-000000000006`;
  lease.organization.state = "owned";
  lease.worksite.state = "owned";
  lease.managerProfile.state = "owned";
  lease.managerMembership.state = "owned";
  return lease;
}

function deferred<T>() {
  let reject!: (error: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function runtime({
  insertProcessResult,
}: { insertProcessResult?: Record<string, unknown> } = {}) {
  const sessions: Array<{
    cancel: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    label: string;
    result: Promise<unknown>;
    settled: boolean;
    waitForJson: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  }> = [];
  const pending = new Map<
    string,
    ReturnType<typeof deferred<Record<string, unknown>>>
  >();

  const settle = (label: string, value: Record<string, unknown>) => {
    const item = pending.get(label);
    if (!item) return;
    const session = sessions.find((candidate) => candidate.label === label);
    if (session) session.settled = true;
    item.resolve(value);
  };

  const startSession = vi.fn(({ label }: { label: string }) => {
    const item = deferred<Record<string, unknown>>();
    void item.promise.catch(() => {});
    pending.set(label, item);
    const session = {
      cancel: vi.fn(() => {
        if (session.settled) return;
        session.settled = true;
        item.reject(new Error(`${label} cancelled`));
      }),
      end: vi.fn(),
      label,
      result: item.promise,
      settled: false,
      waitForJson: vi.fn(async () => ({
        application_name: createNativeSessionIdentity(fixtureLease().runId)
          .gateApplication,
        backend_pid: ids.gate,
        status: "gate_held",
      })),
      write: vi.fn((sql: string) => {
        if (!sql.includes("gate_released")) return;
        settle("Native verification gate", {
          code: 0,
          errorEvidence: { constraint: null, ownershipRefused: false, sqlstate: null },
          jsonValues: [{ status: "gate_held" }, { status: "gate_released" }],
          signal: null,
        });
        settle("Native verification cleanup", {
          code: 0,
          errorEvidence: { constraint: null, ownershipRefused: false, sqlstate: null },
          jsonValues: [{ status: "database_cleaned" }],
          signal: null,
        });
        settle("Native verification concurrent insert", {
          ...(insertProcessResult ?? {
            code: 0,
            errorEvidence: {
              constraint: null,
              ownershipRefused: false,
              sqlstate: null,
            },
            jsonValues: [
              {
                constraint: "invitations_organization_id_fkey",
                sqlstate: "23503",
                status: "database_rejected",
              },
            ],
            signal: null,
          }),
        });
      }),
    };
    sessions.push(session);
    return session;
  });

  return { sessions, startSession };
}

function observations(
  overrides: {
    cleanup?: Record<string, unknown>;
    insert?: Record<string, unknown>;
    postconditions?: Record<string, unknown>;
  } = {},
) {
  return vi.fn(async (sql: string) => {
    if (sql.includes("cleanup_gate_observation")) {
      return {
        cleanup_blockers: [ids.gate],
        cleanup_count: 1,
        cleanup_pid: ids.cleanup,
        organization_lock_granted: true,
        status: "cleanup_gate_observation",
        ...overrides.cleanup,
      };
    }
    if (sql.includes("insert_wait_observation")) {
      return {
        cleanup_count: 1,
        cleanup_invitation_lock_granted: true,
        cleanup_pid: ids.cleanup,
        insert_blockers: [ids.cleanup],
        insert_count: 1,
        insert_invitation_lock_waiting: true,
        insert_pid: ids.insert,
        insert_wait_event_type: "Lock",
        status: "insert_wait_observation",
        ...overrides.insert,
      };
    }
    if (sql.includes("'postconditions'")) {
      return {
        concurrent_invitation_absent: true,
        sentinel_owned: true,
        status: "postconditions",
        target_application_absent: true,
        target_auth_owned: true,
        trigger_enabled: true,
        ...overrides.postconditions,
      };
    }
    throw new Error("Unexpected observation boundary");
  });
}

function scenarioOptions(
  harness: ReturnType<typeof runtime>,
  observe = observations(),
  finalizeLease = vi.fn(async () => ({ remaining: [], status: "cleaned" })),
) {
  return {
    deadlines: {
      childMs: 1_000,
      finalDrainMs: 100,
      gateReadyMs: 100,
      observerMs: 100,
      pollAttempts: 1,
      pollDelayMs: 1,
      scenarioMs: 1_000,
    },
    finalizeLease,
    lease: fixtureLease(),
    observe,
    sentinelLease: fixtureLease(1),
    settings: {
      dockerEndpoint: "unix:///var/run/docker.sock",
      dockerEnvironment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
    },
    sleep: vi.fn(async () => {}),
    startSession: harness.startSession,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("native cleanup SQL boundaries", () => {
  it("places controlled gate after proof with per-run backend names", () => {
    const lease = fixtureLease();
    const identity = createNativeSessionIdentity(lease.runId);
    const sql = buildControlledCleanupSql(lease, identity);

    expect(sql.indexOf("local_auth_fixture_ownership_unverified")).toBeLessThan(
      sql.indexOf("pg_advisory_xact_lock"),
    );
    expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      sql.indexOf("delete from private.manager_mfa_registrations"),
    );
    expect(sql).toContain(
      `set local application_name = '${identity.cleanupApplication}'`,
    );
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '20s'");
    expect(sql).toContain("set local idle_in_transaction_session_timeout = '20s'");
  });

  it("prepares isolated ownership-refusal and trigger-rollback probes", () => {
    const lease = fixtureLease();
    const identity = createNativeSessionIdentity(lease.runId);

    expect(buildOwnershipRefusalSql(lease, identity)).toContain(
      "set name = name || ' refusal-probe'",
    );
    expect(buildTriggerRollbackSql(lease, identity)).toContain(
      "disable trigger audit_events_reject_mutation;\nselect 1 / 0;",
    );
  });

  it("retains only structured PostgreSQL error evidence", () => {
    expect(
      parsePostgresErrorEvidence(
        'ERROR:  23503: private detail violates foreign key constraint "invitations_organization_id_fkey"',
      ),
    ).toEqual({
      constraint: "invitations_organization_id_fkey",
      ownershipRefused: false,
      sqlstate: "23503",
    });
  });

  it("emits both read-only observer queries without qualified COALESCE", async () => {
    const identity = createNativeSessionIdentity(fixtureLease().runId);
    const observe = vi.fn(async (sql: string) => ({
      status: sql.includes("cleanup_gate_observation")
        ? "cleanup_gate_observation"
        : "insert_wait_observation",
    }));

    await expect(runObserverSqlSmokeCheck({ identity, observe })).resolves.toEqual({
      status: "observer_sql_valid",
    });

    const emitted = observe.mock.calls.map(([sql]) => sql);
    expect(emitted).toHaveLength(2);
    expect(emitted.every((sql) => sql.includes("coalesce("))).toBe(true);
    expect(emitted.every((sql) => !sql.includes("pg_catalog.coalesce("))).toBe(true);
    expect(emitted[0]).toContain(identity.cleanupApplication);
    expect(emitted[1]).toContain(identity.cleanupApplication);
    expect(emitted[1]).toContain(identity.insertApplication);
    expect(emitted.every((sql) => sql.includes("pg_catalog.pg_blocking_pids"))).toBe(
      true,
    );
  });
});

describe("native cleanup interleaving control flow", () => {
  it("proves exact backends, blocker relation, FK rejection, and postconditions", async () => {
    const harness = runtime();
    const observe = observations();
    const finalizeLease = vi.fn(async () => ({ remaining: [], status: "cleaned" }));

    await expect(
      runNativeInterleavingScenario(scenarioOptions(harness, observe, finalizeLease)),
    ).resolves.toEqual({
      cleanupBackendPid: ids.cleanup,
      insertBackendPid: ids.insert,
      status: "verified",
    });

    expect(harness.startSession.mock.calls.map(([value]) => value.label)).toEqual([
      "Native verification gate",
      "Native verification cleanup",
      "Native verification concurrent insert",
    ]);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(finalizeLease).toHaveBeenCalledOnce();
    const emitted = observe.mock.calls.map(([sql]) => sql);
    expect(emitted[0]).not.toContain("pg_catalog.coalesce(");
    expect(emitted[1]).not.toContain("pg_catalog.coalesce(");
    expect(emitted[0]).toContain("pg_catalog.pg_blocking_pids");
    expect(emitted[1]).toContain("pg_catalog.pg_blocking_pids");
  });

  it("rejects an unrelated blocker after reaching both database child boundaries", async () => {
    const harness = runtime();
    const observe = observations({ insert: { insert_blockers: [999] } });
    const finalizeLease = vi.fn();

    await expect(
      runNativeInterleavingScenario(scenarioOptions(harness, observe, finalizeLease)),
    ).rejects.toThrow("Native concurrent insert wait could not be proven");

    expect(harness.startSession).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(finalizeLease).not.toHaveBeenCalled();
    expect(harness.sessions[0]?.write).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing cleanup backend before starting concurrent mutation", async () => {
    const harness = runtime();
    const observe = observations({ cleanup: { cleanup_count: 0, cleanup_pid: null } });
    const finalizeLease = vi.fn();

    await expect(
      runNativeInterleavingScenario(scenarioOptions(harness, observe, finalizeLease)),
    ).rejects.toThrow("Native cleanup ownership gate could not be proven");

    expect(harness.startSession).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledOnce();
    expect(finalizeLease).not.toHaveBeenCalled();
  });

  it("rejects observer failure after reaching both database child boundaries", async () => {
    const harness = runtime();
    const baseline = observations();
    const observe = vi
      .fn()
      .mockImplementationOnce(baseline)
      .mockRejectedValueOnce(new Error("synthetic observer transport failure"));
    const finalizeLease = vi.fn();

    await expect(
      runNativeInterleavingScenario(scenarioOptions(harness, observe, finalizeLease)),
    ).rejects.toThrow("synthetic observer transport failure");

    expect(harness.startSession).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(finalizeLease).not.toHaveBeenCalled();
  });

  it.each([
    [
      "syntax failure",
      {
        code: 2,
        errorEvidence: { constraint: null, ownershipRefused: false, sqlstate: "42601" },
        jsonValues: [],
      },
    ],
    [
      "wrong constraint",
      {
        code: 0,
        jsonValues: [
          {
            constraint: "other_foreign_key",
            sqlstate: "23503",
            status: "database_rejected",
          },
        ],
      },
    ],
    [
      "unexpected insert success",
      { code: 0, jsonValues: [{ status: "unexpected_insert" }] },
    ],
  ])("rejects %s after exact wait proof", async (_label, insertResult) => {
    const harness = runtime({ insertProcessResult: insertResult });
    const observe = observations();
    const finalizeLease = vi.fn();

    await expect(
      runNativeInterleavingScenario(scenarioOptions(harness, observe, finalizeLease)),
    ).rejects.toThrow("exact expected foreign-key rejection");

    expect(harness.startSession).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(finalizeLease).not.toHaveBeenCalled();
  });

  it("bounds a hanging observer and performs no Auth cleanup", async () => {
    vi.useFakeTimers();
    const harness = runtime();
    const observe = vi.fn(() => new Promise(() => {}));
    const finalizeLease = vi.fn();
    const pending = runNativeInterleavingScenario({
      ...scenarioOptions(harness, observe, finalizeLease),
      deadlines: {
        childMs: 100,
        finalDrainMs: 10,
        gateReadyMs: 10,
        observerMs: 10,
        pollAttempts: 1,
        pollDelayMs: 1,
        scenarioMs: 50,
      },
    });
    const rejected = expect(pending).rejects.toThrow("timed out safely");

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(harness.startSession).toHaveBeenCalledTimes(2);
    expect(finalizeLease).not.toHaveBeenCalled();
    expect(
      harness.sessions.every((session) => session.cancel.mock.calls.length > 0),
    ).toBe(true);
  });

  it("bounds hanging finalization after confirmed database postconditions", async () => {
    vi.useFakeTimers();
    const harness = runtime();
    const finalizeLease = vi.fn(() => new Promise(() => {}));
    const pending = runNativeInterleavingScenario({
      ...scenarioOptions(harness, observations(), finalizeLease),
      deadlines: {
        childMs: 100,
        finalDrainMs: 10,
        gateReadyMs: 10,
        observerMs: 10,
        pollAttempts: 1,
        pollDelayMs: 1,
        scenarioMs: 50,
      },
    });
    const rejected = expect(pending).rejects.toThrow(
      "Native cleanup interleaving scenario timed out safely",
    );

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(finalizeLease).toHaveBeenCalledOnce();
  });
});

describe("bounded native child ownership", () => {
  function childProcess(
    onKill: (signal: string, child: EventEmitter) => void = () => {},
  ) {
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      stderr: PassThrough;
      stdin: PassThrough;
      stdout: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn((signal: string) => onKill(signal, child));
    return child;
  }

  function startSyntheticChild(child: ReturnType<typeof childProcess>) {
    const session = startBoundedOperatorSql({
      forceTerminationMs: 10,
      gracefulTerminationMs: 5,
      label: "Synthetic owned child",
      settings: {
        dockerEndpoint: "unix:///var/run/docker.sock",
        dockerEnvironment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
      },
      spawnCommand: vi.fn(() => child),
      timeoutMs: 25,
    });
    session.end("select 1;");
    return session;
  }

  it("waits for graceful owned-child exit before settling the deadline", async () => {
    vi.useFakeTimers();
    const child = childProcess((signal, ownedChild) => {
      if (signal === "SIGTERM") ownedChild.emit("close", null, "SIGTERM");
    });
    const session = startSyntheticChild(child);
    const rejected = expect(session.result).rejects.toThrow("timed out safely");

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    await expect(session.exit).resolves.toEqual({
      code: null,
      confirmed: true,
      signal: "SIGTERM",
    });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
  });

  it("force-kills only its owned SIGTERM-ignoring child and confirms exit", async () => {
    vi.useFakeTimers();
    const child = childProcess((signal, ownedChild) => {
      if (signal === "SIGKILL") ownedChild.emit("close", null, "SIGKILL");
    });
    const session = startSyntheticChild(child);
    const rejected = expect(session.result).rejects.toThrow("timed out safely");

    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    await expect(session.exit).resolves.toEqual({
      code: null,
      confirmed: true,
      signal: "SIGKILL",
    });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("reports unconfirmed termination and safely consumes late child events", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const session = startSyntheticChild(child);
    const rejected = expect(session.result).rejects.toThrow(
      "Owned process termination was not confirmed",
    );

    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    await expect(session.exit).resolves.toEqual({
      code: null,
      confirmed: false,
      signal: null,
    });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(child.listenerCount("error")).toBe(1);

    expect(() =>
      child.emit("error", new Error("synthetic late child error")),
    ).not.toThrow();
    child.emit("close", null, "SIGKILL");
    expect(child.listenerCount("error")).toBe(0);
  });

  it("bounds final drain even when a synthetic child ignores cancellation", async () => {
    vi.useFakeTimers();
    const session = {
      cancel: vi.fn(),
      result: new Promise(() => {}),
    };
    const draining = drainOwnedSessions([session], { timeoutMs: 20 });

    await vi.advanceTimersByTimeAsync(20);
    await expect(draining).resolves.toBe(false);
    expect(session.cancel).toHaveBeenCalled();
  });
});
