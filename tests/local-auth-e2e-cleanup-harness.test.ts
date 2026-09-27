import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAuthE2eLease } from "../scripts/local-auth-e2e-fixture.mjs";
import {
  buildClockGraphSql,
  buildControlledCleanupSql,
  buildCrossTenantClockRefusalSql,
  buildOwnershipRefusalSql,
  buildTriggerRollbackSql,
  createClockGraphTimeline,
  createNativeHarnessAllocation,
  createNativeRecoveryEvidence,
  createNativeSessionIdentity,
  drainOwnedSessions,
  parsePostgresErrorEvidence,
  runNativeRecoveryPlan,
  runNativeInterleavingScenario,
  runObserverSqlSmokeCheck,
  startBoundedOperatorSql,
  validateClockGraphTimeline,
  writeNativeRecoveryEnvelopeAtomic,
} from "./local-auth-e2e-cleanup.postgres.mjs";

const ids = {
  cleanup: 702,
  gate: 701,
  insert: 703,
};
const recoveryRoots: string[] = [];

type MutableRecoveryLease = {
  cleanup: { database: string };
  employee: {
    emailAbsent: boolean;
    invitationAttempted: boolean;
    invitationId: string | null;
    state: string;
    userId: string | null;
  };
  manager: { emailAbsent: boolean; state: string; userId: string | null };
  managerMembership: { state: string };
  managerProfile: { state: string };
  organization: { state: string };
  worksite: { state: string };
};

function deterministicUuid(
  index: number,
): `${string}-${string}-${string}-${string}-${string}` {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function recoveryAllocation(events: string[] = []) {
  let index = 0;
  return createNativeHarnessAllocation({
    createId: () => {
      index += 1;
      events.push(`allocate:${index}`);
      return deterministicUuid(index);
    },
    now: () => new Date("2026-09-13T10:00:00.000Z"),
  });
}

function ownManager(lease: MutableRecoveryLease, userId: string) {
  lease.manager.emailAbsent = true;
  lease.manager.state = "owned";
  lease.manager.userId = userId;
  lease.organization.state = "owned";
  lease.worksite.state = "owned";
  lease.managerProfile.state = "owned";
  lease.managerMembership.state = "owned";
}

function ownEmployee(
  lease: MutableRecoveryLease,
  { invitationId, userId }: { invitationId: string; userId: string },
) {
  lease.employee.emailAbsent = true;
  lease.employee.invitationAttempted = true;
  lease.employee.invitationId = invitationId;
  lease.employee.state = "owned";
  lease.employee.userId = userId;
}

function cleanTarget(lease: MutableRecoveryLease) {
  lease.cleanup.database = "cleaned";
  lease.employee.state = "deleted";
  lease.manager.state = "deleted";
}

function cleanSentinel(lease: MutableRecoveryLease) {
  lease.cleanup.database = "cleaned";
  lease.manager.state = "deleted";
}

async function temporaryRecoveryRoot() {
  const root = await mkdtemp(join(tmpdir(), "cloxa-native-recovery-test-"));
  recoveryRoots.push(root);
  return root;
}

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

function ownedClockFixture(offset = 0) {
  const lease = fixtureLease(offset);
  lease.employee.emailAbsent = true;
  lease.employee.invitationAttempted = true;
  lease.employee.invitationId = `a700000${offset}-0000-4000-8000-000000000007`;
  lease.employee.state = "owned";
  lease.employee.userId = `a800000${offset}-0000-4000-8000-000000000008`;
  return {
    graph: {
      breakIds: [
        `b100000${offset}-0000-4000-8000-000000000011`,
        `b200000${offset}-0000-4000-8000-000000000012`,
      ],
      breakOperationIds: [
        `b300000${offset}-0000-4000-8000-000000000013`,
        `b400000${offset}-0000-4000-8000-000000000014`,
        `b500000${offset}-0000-4000-8000-000000000015`,
        `b600000${offset}-0000-4000-8000-000000000016`,
      ],
      clockRequestIds: [
        `b700000${offset}-0000-4000-8000-000000000017`,
        `b800000${offset}-0000-4000-8000-000000000018`,
      ],
      employeeMembershipId: `a900000${offset}-0000-4000-8000-000000000009`,
      entryId: `c100000${offset}-0000-4000-8000-000000000010`,
    },
    lease,
  };
}

function generatedBreakRows(sql: string) {
  const pattern =
    /insert into public\.time_breaks\s*\([^)]*\)\s*values\s*\(\s*'[^']+'::uuid,\s*'[^']+'::uuid,\s*'[^']+'::uuid,\s*'[^']+'::uuid,\s*'[^']+'::uuid,\s*'([^']+)'::timestamptz,\s*'([^']+)'::timestamptz\s*\);/gu;
  return [...sql.matchAll(pattern)].map((match) => ({
    createdAt: match[2],
    startedAt: match[1],
  }));
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
  const { graph, lease } = ownedClockFixture();
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
    graph,
    lease,
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

function recoverySteps(
  allocation: ReturnType<typeof recoveryAllocation>,
  events: string[] = [],
) {
  const stopped = () => ({ ownedProcessesStopped: true });
  return {
    abortOwnedOperations: vi.fn(() => events.push("abort")),
    cleanupSentinel: vi.fn(async () => {
      events.push("mutation:sentinel-cleanup");
      cleanSentinel(allocation.sentinelLease);
      return stopped();
    }),
    createClockGraph: vi.fn(async () => {
      events.push("mutation:clock-graph");
      return stopped();
    }),
    crossTenantRefusal: vi.fn(async () => {
      events.push("mutation:cross-tenant-refusal");
      return stopped();
    }),
    finishSentinelOperation: vi.fn(() => events.push("sentinel-operation-finished")),
    interleavingCleanup: vi.fn(async () => {
      events.push("mutation:interleaving-cleanup");
      cleanTarget(allocation.targetLease);
      return stopped();
    }),
    observerSmoke: vi.fn(async () => {
      events.push("read:observer-smoke");
      return stopped();
    }),
    ownershipRefusal: vi.fn(async () => {
      events.push("mutation:ownership-refusal");
      return stopped();
    }),
    provisionSentinelManager: vi.fn(async () => {
      events.push("mutation:sentinel-manager");
      ownManager(allocation.sentinelLease, deterministicUuid(102));
    }),
    provisionTargetEmployee: vi.fn(async () => {
      events.push("mutation:target-employee");
      ownEmployee(allocation.targetLease, {
        invitationId: allocation.invitationId,
        userId: deterministicUuid(103),
      });
      return {
        employeeMembershipId: allocation.graph.employeeMembershipId,
        invitationId: allocation.invitationId,
        userId: allocation.targetLease.employee.userId,
      };
    }),
    provisionTargetManager: vi.fn(async () => {
      events.push("mutation:target-manager");
      ownManager(allocation.targetLease, deterministicUuid(101));
    }),
    triggerRollback: vi.fn(async (triggerBoundary: string) => {
      events.push(`mutation:trigger:${triggerBoundary}`);
      return stopped();
    }),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    recoveryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("native recovery evidence", () => {
  it("preallocates identities and atomically checkpoints the complete workflow", async () => {
    const events: string[] = [];
    const allocation = recoveryAllocation(events);
    const allocationEvents = events.filter((event) => event.startsWith("allocate:"));
    const controlledIds = [
      allocation.targetLease.runId,
      allocation.targetLease.proof,
      allocation.targetLease.organization.id,
      allocation.targetLease.worksite.id,
      allocation.targetLease.managerMembership.id,
      allocation.sentinelLease.runId,
      allocation.sentinelLease.proof,
      allocation.sentinelLease.organization.id,
      allocation.sentinelLease.worksite.id,
      allocation.sentinelLease.managerMembership.id,
      allocation.invitationId,
      allocation.graph.employeeMembershipId,
      allocation.graph.entryId,
      ...allocation.graph.breakIds,
      ...allocation.graph.clockRequestIds,
      ...allocation.graph.breakOperationIds,
      allocation.crossTenantRefusalRequestId,
    ];
    expect(allocationEvents).toHaveLength(22);
    expect(new Set(controlledIds).size).toBe(22);

    const root = await temporaryRecoveryRoot();
    const writes: Array<Record<string, unknown>> = [];
    const writeAtomic = vi.fn(async (filePath, envelope) => {
      const snapshot = structuredClone(envelope) as Record<string, unknown>;
      writes.push(snapshot);
      events.push(`write:${String(snapshot.currentPhase)}:${String(snapshot.status)}`);
      await writeNativeRecoveryEnvelopeAtomic(filePath, envelope);
    });
    const printRecoveryPath = vi.fn((filePath: string) => {
      events.push(`print:${filePath}`);
    });
    let tick = 0;
    const result = await runNativeRecoveryPlan({
      allocation,
      evidenceOptions: {
        now: () => new Date(Date.parse("2026-09-13T10:00:01.000Z") + tick++),
        temporaryRoot: root,
        writeAtomic,
      },
      printRecoveryPath,
      steps: recoverySteps(allocation, events),
    });

    const firstMutation = events.findIndex((event) => event.startsWith("mutation:"));
    const initialWrite = events.indexOf("write:identities_allocated:active");
    const printedPath = printRecoveryPath.mock.calls[0]?.[0];
    expect(initialWrite).toBeGreaterThan(events.lastIndexOf("allocate:22"));
    expect(firstMutation).toBeGreaterThan(initialWrite);
    expect(events.findIndex((event) => event.startsWith("print:"))).toBeLessThan(
      firstMutation,
    );
    expect(printedPath).toBe(result.evidencePath);
    expect(printedPath).toContain(allocation.targetLease.runId);

    const initial = writes[0] as {
      allocations: Record<string, unknown>;
      currentPhase: string;
      sentinel: { manager: { userId: string | null }; proof: string };
      status: string;
      target: { manager: { userId: string | null }; proof: string };
    };
    expect(initial).toMatchObject({
      allocations: {
        applications: allocation.identity,
        crossTenantRefusalRequestId: allocation.crossTenantRefusalRequestId,
        graph: allocation.graph,
        invitationId: allocation.invitationId,
      },
      createdAt: "2026-09-13T10:00:01.000Z",
      currentPhase: "identities_allocated",
      harness: "local-auth-e2e-native-postgresql-cleanup",
      nativeCleanupHarness: true,
      schema: "cloxa.native-cleanup-recovery",
      sentinel: {
        employee: { email: allocation.sentinelLease.employee.email },
        manager: { email: allocation.sentinelLease.manager.email },
        managerMembership: { id: allocation.sentinelLease.managerMembership.id },
        marker: allocation.sentinelLease.marker,
        organization: { id: allocation.sentinelLease.organization.id },
        runId: allocation.sentinelLease.runId,
        startedAt: allocation.sentinelLease.startedAt,
        worksite: { id: allocation.sentinelLease.worksite.id },
      },
      status: "active",
      target: {
        employee: { email: allocation.targetLease.employee.email },
        manager: { email: allocation.targetLease.manager.email },
        managerMembership: { id: allocation.targetLease.managerMembership.id },
        marker: allocation.targetLease.marker,
        organization: { id: allocation.targetLease.organization.id },
        runId: allocation.targetLease.runId,
        startedAt: allocation.targetLease.startedAt,
        worksite: { id: allocation.targetLease.worksite.id },
      },
      updatedAt: "2026-09-13T10:00:01.000Z",
      version: 1,
    });
    expect(initial.target.manager.userId).toBeNull();
    expect(initial.sentinel.manager.userId).toBeNull();
    expect(initial.target.proof).toBe(allocation.targetLease.proof);
    expect(initial.sentinel.proof).toBe(allocation.sentinelLease.proof);
    expect(JSON.stringify(initial)).not.toMatch(
      /password|secret|service_role|access_token|refresh_token|cookie|mfa|docker/iu,
    );

    const targetManagerCheckpoint = writes.find(
      (item) => item.currentPhase === "target_manager_provisioned",
    ) as { target: { manager: { state: string; userId: string } } };
    const sentinelManagerCheckpoint = writes.find(
      (item) => item.currentPhase === "sentinel_manager_provisioned",
    ) as { sentinel: { manager: { state: string; userId: string } } };
    const employeeCheckpoint = writes.find(
      (item) => item.currentPhase === "target_employee_provisioned",
    ) as {
      target: {
        employee: { invitationId: string; state: string; userId: string };
      };
    };
    expect(targetManagerCheckpoint.target.manager).toEqual({
      email: allocation.targetLease.manager.email,
      emailAbsent: true,
      state: "owned",
      userId: deterministicUuid(101),
    });
    expect(sentinelManagerCheckpoint.sentinel.manager).toEqual({
      email: allocation.sentinelLease.manager.email,
      emailAbsent: true,
      state: "owned",
      userId: deterministicUuid(102),
    });
    expect(employeeCheckpoint.target.employee).toMatchObject({
      invitationId: allocation.invitationId,
      state: "owned",
      userId: deterministicUuid(103),
    });

    const serialized = await readFile(result.evidencePath, "utf8");
    const finalEvidence = JSON.parse(serialized);
    const phases = finalEvidence.checkpoints.map(
      (checkpoint: { phase: string }) => checkpoint.phase,
    );
    expect(phases.slice(0, 7)).toEqual([
      "identities_allocated",
      "target_manager_provisioned",
      "sentinel_manager_provisioned",
      "target_employee_provisioned",
      "clock_graph_allocated_created",
      "ownership_refusal_passed",
      "cross_tenant_refusal_passed",
    ]);
    const triggerCheckpoints = finalEvidence.checkpoints.filter(
      (checkpoint: { phase: string }) =>
        checkpoint.phase === "trigger_boundary_rollback_passed",
    );
    expect(triggerCheckpoints).toHaveLength(10);
    expect(
      triggerCheckpoints.map(
        (checkpoint: { details: { index: number } }) => checkpoint.details.index,
      ),
    ).toEqual([...Array(10).keys()]);
    expect(phases.slice(-5)).toEqual([
      "interleaving_cleanup_completed",
      "target_auth_cleanup_completed",
      "sentinel_cleanup_completed",
      "owned_processes_confirmed_stopped",
      "cleaned",
    ]);
    expect(writeAtomic).toHaveBeenCalledTimes(phases.length);
    expect(finalEvidence).toMatchObject({
      confirmations: {
        ownedChildrenStopped: true,
        sentinelCleaned: true,
        targetAuthCleaned: true,
      },
      currentPhase: "cleaned",
      resourcesRemaining: false,
      status: "cleaned",
    });
    expect(finalEvidence.target.proof).toBeNull();
    expect(finalEvidence.sentinel.proof).toBeNull();
    expect(finalEvidence.target.proofStatus).toBe("redacted_after_cleanup");
    expect(finalEvidence.sentinel.proofStatus).toBe("redacted_after_cleanup");
    expect(serialized).not.toContain(allocation.targetLease.proof);
    expect(serialized).not.toContain(allocation.sentinelLease.proof);
    expect(serialized).not.toMatch(
      /password|service_role|access_token|refresh_token/iu,
    );
    await expect(readFile(`${result.evidencePath}.next`, "utf8")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    expect(events.indexOf("write:cleaned:cleaned")).toBeGreaterThan(
      events.indexOf("sentinel-operation-finished"),
    );
  });

  it("blocks every external step when the initial atomic write fails", async () => {
    const events: string[] = [];
    const allocation = recoveryAllocation(events);
    const steps = recoverySteps(allocation, events);
    const printRecoveryPath = vi.fn();

    await expect(
      runNativeRecoveryPlan({
        allocation,
        evidenceOptions: {
          temporaryRoot: await temporaryRecoveryRoot(),
          writeAtomic: vi.fn(async () => {
            throw new Error("synthetic initial write failure");
          }),
        },
        printRecoveryPath,
        steps,
      }),
    ).rejects.toThrow("could not be created before mutation");

    expect(events.filter((event) => event.startsWith("allocate:"))).toHaveLength(22);
    expect(events.some((event) => event.startsWith("mutation:"))).toBe(false);
    expect(steps.observerSmoke).not.toHaveBeenCalled();
    expect(steps.provisionTargetManager).not.toHaveBeenCalled();
    expect(steps.abortOwnedOperations).toHaveBeenCalledOnce();
    expect(printRecoveryPath).not.toHaveBeenCalled();
  });

  it("retains exact recovery identities while sanitizing a simulated failure", async () => {
    const allocation = recoveryAllocation();
    const steps = recoverySteps(allocation);
    const providerSecret = "synthetic-provider-password-and-token";
    steps.provisionSentinelManager.mockImplementationOnce(async () => {
      ownManager(allocation.sentinelLease, deterministicUuid(102));
      const error = new Error(
        `provider rejected ${providerSecret} ${allocation.targetLease.proof}`,
      );
      error.name = "ProviderError";
      throw error;
    });
    const printed: string[] = [];
    let caught: (Error & { cause?: Error }) | undefined;
    try {
      await runNativeRecoveryPlan({
        allocation,
        evidenceOptions: { temporaryRoot: await temporaryRecoveryRoot() },
        printRecoveryPath: (filePath: string) => printed.push(filePath),
        steps,
      });
    } catch (error) {
      caught = error as Error & { cause?: Error };
    }

    const recoveryPath = printed[0];
    if (!recoveryPath) throw new Error("Recovery evidence path was not printed.");
    expect(caught).toBeDefined();
    expect(caught?.message).toContain(recoveryPath);
    expect(caught?.message).not.toContain(allocation.targetLease.proof);
    expect(caught?.cause?.name).toBe("ProviderError");
    expect(caught?.cause?.message).not.toContain(providerSecret);
    expect(printed.join("\n")).not.toContain(allocation.targetLease.proof);
    expect(steps.provisionTargetEmployee).not.toHaveBeenCalled();
    expect(steps.abortOwnedOperations).toHaveBeenCalledOnce();

    const serialized = await readFile(recoveryPath, "utf8");
    const failedEvidence = JSON.parse(serialized);
    expect(failedEvidence).toMatchObject({
      allocations: {
        crossTenantRefusalRequestId: allocation.crossTenantRefusalRequestId,
        graph: allocation.graph,
        invitationId: allocation.invitationId,
      },
      currentPhase: "target_manager_provisioned",
      failure: {
        message: "Native cleanup phase failed; fixture resources were preserved.",
        name: "ProviderError",
      },
      resourcesRemaining: true,
      status: "failed",
    });
    expect(failedEvidence.target.manager.userId).toBe(deterministicUuid(101));
    expect(failedEvidence.sentinel.manager.userId).toBe(deterministicUuid(102));
    expect(failedEvidence.target.proof).toBe(allocation.targetLease.proof);
    expect(failedEvidence.sentinel.proof).toBe(allocation.sentinelLease.proof);
    expect(failedEvidence.checkpoints.at(-1)).toMatchObject({
      lastConfirmedPhase: "target_manager_provisioned",
      phase: "failed",
    });
    expect(serialized).not.toContain(providerSecret);
  });

  it("stops before the next mutation when a later checkpoint fails", async () => {
    const allocation = recoveryAllocation();
    const steps = recoverySteps(allocation);
    const root = await temporaryRecoveryRoot();
    let writes = 0;
    const writeAtomic = vi.fn(async (filePath, envelope) => {
      writes += 1;
      if (writes > 1) throw new Error("synthetic checkpoint failure");
      await writeNativeRecoveryEnvelopeAtomic(filePath, envelope);
    });
    const printed: string[] = [];

    let caught: Error | undefined;
    try {
      await runNativeRecoveryPlan({
        allocation,
        evidenceOptions: { temporaryRoot: root, writeAtomic },
        printRecoveryPath: (filePath: string) => printed.push(filePath),
        steps,
      });
    } catch (error) {
      caught = error as Error;
    }

    const recoveryPath = printed[0];
    if (!recoveryPath) throw new Error("Recovery evidence path was not printed.");
    expect(caught?.message).toContain(`Recovery evidence: ${recoveryPath}`);
    expect(steps.provisionTargetManager).toHaveBeenCalledOnce();
    expect(steps.provisionSentinelManager).not.toHaveBeenCalled();
    expect(steps.abortOwnedOperations).toHaveBeenCalledOnce();
    expect(writeAtomic).toHaveBeenCalledTimes(3);
    const retained = JSON.parse(await readFile(recoveryPath, "utf8"));
    expect(retained).toMatchObject({
      currentPhase: "identities_allocated",
      status: "active",
    });
    expect(retained.target.proof).toBe(allocation.targetLease.proof);
    expect(retained.allocations.graph).toEqual(allocation.graph);
  });

  it("refuses a cleaned report until both fixtures and child exits are confirmed", async () => {
    const allocation = recoveryAllocation();
    const evidence = await createNativeRecoveryEvidence({
      allocation,
      temporaryRoot: await temporaryRecoveryRoot(),
    });

    await expect(evidence.complete()).rejects.toThrow(
      "success conditions were not confirmed",
    );
    const retained = JSON.parse(await readFile(evidence.path, "utf8"));
    expect(retained.status).toBe("active");
    expect(retained.resourcesRemaining).toBe(true);
    expect(retained.target.proof).toBe(allocation.targetLease.proof);
  });
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

  it("builds a deterministic clock graph compatible with production timing", async () => {
    const { graph, lease } = ownedClockFixture();
    const now = new Date("2026-09-06T10:00:01.000Z");
    const timeline = createClockGraphTimeline(lease, { now: () => now });
    const timelineBreaks = timeline.breaks as [
      { createdAt: string; endedAt: string; startedAt: string },
      { createdAt: string; endedAt: string; startedAt: string },
    ];
    const graphSql = buildClockGraphSql(lease, graph, { now: () => now });
    const liveBreakMigration = await readFile(
      new URL(
        "../supabase/migrations/20260903230921_employee_live_breaks.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(liveBreakMigration).toMatch(
      /isfinite\(started_at\)[\s\S]*?isfinite\(created_at\)[\s\S]*?created_at\s*=\s*started_at/u,
    );
    expect(timeline).toEqual({
      breaks: [
        {
          createdAt: "2026-09-06T10:00:00.002Z",
          endedAt: "2026-09-06T10:00:00.003Z",
          startedAt: "2026-09-06T10:00:00.002Z",
        },
        {
          createdAt: "2026-09-06T10:00:00.004Z",
          endedAt: "2026-09-06T10:00:00.005Z",
          startedAt: "2026-09-06T10:00:00.004Z",
        },
      ],
      entry: {
        createdAt: "2026-09-06T10:00:00.001Z",
        endedAt: "2026-09-06T10:00:00.006Z",
        startedAt: "2026-09-06T10:00:00.001Z",
      },
    });
    expect(generatedBreakRows(graphSql)).toEqual(
      timelineBreaks.map(({ createdAt, startedAt }) => ({
        createdAt,
        startedAt,
      })),
    );
    expect(
      timelineBreaks.every(
        ({ createdAt, startedAt }) =>
          createdAt === startedAt &&
          Date.parse(createdAt) >= Date.parse(lease.startedAt),
      ),
    ).toBe(true);
    expect(
      [
        timeline.entry.startedAt,
        timelineBreaks[0].startedAt,
        timelineBreaks[0].endedAt,
        timelineBreaks[1].startedAt,
        timelineBreaks[1].endedAt,
        timeline.entry.endedAt,
      ].map(Date.parse),
    ).toEqual([...Array(6)].map((_, index) => Date.parse(lease.startedAt) + index + 1));
    expect(graphSql).not.toContain("clock_timestamp()");
    expect(graphSql).not.toContain("interval '");
    expect(graphSql).toMatch(
      /'clock_in', 'started', id,\s*worksite_id, started_at, null, '2026-09-06T10:00:00\.001Z'::timestamptz/u,
    );
    expect(graphSql).toMatch(
      /'clock_out', 'stopped', id,\s*worksite_id, started_at, ended_at, '2026-09-06T10:00:00\.006Z'::timestamptz/u,
    );

    const mismatchedBreakCreation = structuredClone(timeline);
    mismatchedBreakCreation.breaks[0].createdAt = now.toISOString();
    expect(() =>
      validateClockGraphTimeline(lease, mismatchedBreakCreation, { now: () => now }),
    ).toThrow("Native clock graph timeline is invalid.");

    const beforeLease = structuredClone(timeline);
    beforeLease.breaks[0].createdAt = new Date(
      Date.parse(lease.startedAt) - 1,
    ).toISOString();
    beforeLease.breaks[0].startedAt = beforeLease.breaks[0].createdAt;
    expect(() =>
      validateClockGraphTimeline(lease, beforeLease, { now: () => now }),
    ).toThrow("Native clock graph timeline is invalid.");

    expect(() =>
      createClockGraphTimeline(lease, {
        now: () => new Date(Date.parse(lease.startedAt) + 5),
      }),
    ).toThrow("Native clock graph timeline is invalid.");
  });

  it("matches adjacent production row and update contracts", async () => {
    const { graph, lease } = ownedClockFixture();
    const now = new Date("2026-09-06T10:00:01.000Z");
    const timeline = createClockGraphTimeline(lease, { now: () => now });
    const graphSql = buildClockGraphSql(lease, graph, { now: () => now });
    const [clockMigration, correctionMigration, breakMigration, historyMigration] =
      await Promise.all(
        [
          "20260902193519_employee_time_clock.sql",
          "20260903094913_manager_correction_review.sql",
          "20260903230921_employee_live_breaks.sql",
          "20260904082654_historical_break_corrections_export_v2.sql",
        ].map((name) =>
          readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
        ),
      );

    expect(clockMigration).toMatch(/ended_at is null or ended_at >= started_at/u);
    expect(correctionMigration).toMatch(/version integer not null default 1/u);
    expect(correctionMigration).toMatch(
      /origin in \('clock', 'approved_missed_entry'\)/u,
    );
    expect(correctionMigration).toMatch(/new\.version := old\.version \+ 1/u);
    expect(breakMigration).toMatch(/ended_at > started_at/u);
    expect(breakMigration).toMatch(
      /to_jsonb\(new\) - array\['ended_at', 'version'\][\s\S]*?new\.version := old\.version \+ 1/u,
    );
    expect(breakMigration).toMatch(
      /operation = 'clock_out'[\s\S]*?result_code in \('stopped', 'already_stopped', 'open_break'\)/u,
    );
    expect(breakMigration).toMatch(/octet_length\(payload_hash\) = 32/u);
    expect(historyMigration).toMatch(
      /private\.effective_time_breaks\(old\.id\)[\s\S]*?b\.ended_at > new\.ended_at/u,
    );

    expect(graphSql).toContain("'clock', null");
    expect(graphSql.match(/insert into public\.time_breaks/gu)).toHaveLength(2);
    expect(graphSql.match(/update public\.time_breaks/gu)).toHaveLength(2);
    expect(graphSql).toContain("pg_catalog.sha256(pg_catalog.convert_to(");
    expect(graphSql).toContain("'started_at'");
    expect(graphSql).toContain("'ended_at'");
    expect(graphSql).toContain("'version'");

    let operationCursor = 0;
    for (const [index, operationId] of graph.breakOperationIds.entries()) {
      const blockStart = graphSql.indexOf(
        "insert into private.time_break_operations",
        operationCursor,
      );
      const blockEnd = graphSql.indexOf("\n);", blockStart);
      const breakId = graph.breakIds[Math.floor(index / 2)];
      expect(blockStart).toBeGreaterThanOrEqual(0);
      expect(blockEnd).toBeGreaterThan(blockStart);
      expect(breakId).toBeDefined();
      const operationBlock = graphSql.slice(blockStart, blockEnd);
      const breakTimeline = timeline.breaks[Math.floor(index / 2)];
      const isEnding = index % 2 === 1;
      expect(operationBlock).toContain(`'request_id', '${operationId}'::uuid`);
      expect(operationBlock).toContain(isEnding ? "'end_break'" : "'start_break'");
      expect(operationBlock).toContain(
        `'result_code', '${isEnding ? "ended" : "started"}'`,
      );
      expect(operationBlock).toContain(`'break_id', '${breakId}'::uuid`);
      expect(operationBlock).toContain(`'time_entry_id', '${graph.entryId}'::uuid`);
      expect(operationBlock).toContain(
        `'started_at', '${breakTimeline.startedAt}'::timestamptz`,
      );
      expect(operationBlock).toContain(
        `'ended_at', ${isEnding ? `'${breakTimeline.endedAt}'::timestamptz` : "null"}`,
      );
      expect(operationBlock).toContain(`'version', ${isEnding ? 2 : 1}`);
      expect(operationBlock).toContain(
        `), '${
          isEnding ? breakTimeline.endedAt : breakTimeline.startedAt
        }'::timestamptz`,
      );
      operationCursor = blockEnd + 3;
    }
  });

  it("prepares exact clock graph and cross-tenant refusal probes", () => {
    const { graph, lease } = ownedClockFixture();
    const sentinel = fixtureLease(1);
    const identity = createNativeSessionIdentity(lease.runId);
    const graphSql = buildClockGraphSql(lease, graph, {
      now: () => new Date("2026-09-06T10:00:01.000Z"),
    });
    const refusalSql = buildCrossTenantClockRefusalSql(
      lease,
      sentinel,
      graph,
      identity,
      "d1000000-0000-4000-8000-000000000019",
    );

    expect(graphSql).toContain("'entry_count'");
    expect(graphSql).toContain("'break_count'");
    expect(graphSql).toContain("'clock_request_count'");
    expect(graphSql).toContain("'break_operation_count'");
    expect(refusalSql).toContain(graph.entryId);
    expect(refusalSql).toContain(sentinel.organization.id);
    expect(refusalSql).toContain("local_auth_fixture_ownership_unverified");
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
