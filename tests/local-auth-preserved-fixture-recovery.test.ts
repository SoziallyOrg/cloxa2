import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAuthError } from "../scripts/local-auth-config.mjs";
import {
  buildPreservedFixtureCatalogSql,
  buildPreservedFixtureCleanupSql,
  buildPreservedFixtureSnapshotSql,
  createPreservedFixtureRecoveryEvidence,
  executePreservedFixtureRecovery,
  parsePreservedFixtureRecoveryArguments,
  preservedUxFixtureRecoveryDescriptor as descriptor,
  reconstructPreservedFixtureLease,
  validatePreservedFixtureCatalog,
  validatePreservedFixtureSnapshot,
} from "../scripts/local-auth-preserved-fixture-recovery.mjs";

const proof = "71000000-0000-4000-8000-000000000001";
const otherUuid = "72000000-0000-4000-8000-000000000001";
const boundary = "2026-09-10T16:40:00.000Z";
const at = (milliseconds: number) =>
  new Date(Date.parse(boundary) + milliseconds).toISOString();

function confirmedArgs() {
  return [
    "--confirm-local-development",
    "--confirm-run",
    descriptor.runId,
    "--confirm-organization",
    descriptor.organization.id,
    "--confirm-manager-user",
    descriptor.manager.userId,
    "--confirm-employee-user",
    descriptor.employee.userId,
    "--confirm-preservation-sha256",
    descriptor.preservationSha256,
  ];
}

function parsed() {
  return parsePreservedFixtureRecoveryArguments(confirmedArgs());
}

function appMetadata(role: "manager" | "employee", fixtureProof = proof) {
  return {
    cloxa_local_fixture: descriptor.marker,
    cloxa_local_fixture_organization_id: descriptor.organization.id,
    cloxa_local_fixture_proof: fixtureProof,
    cloxa_local_fixture_role: role,
    cloxa_local_fixture_run_id: descriptor.runId,
  };
}

function authFixture(fixtureProof = proof) {
  return {
    employeeFactors: [] as Array<Record<string, unknown>>,
    employeeUser: {
      app_metadata: appMetadata("employee", fixtureProof),
      created_at: at(1),
      deleted_at: null,
      email: descriptor.employee.email,
      email_confirmed_at: at(2) as string | null,
      id: descriptor.employee.userId,
      invited_at: at(1) as string | null,
    },
    managerFactors: [
      {
        factor_type: "totp",
        id: descriptor.factorId,
        status: "verified",
      },
    ],
    managerUser: {
      app_metadata: appMetadata("manager", fixtureProof),
      created_at: boundary,
      deleted_at: null,
      email: descriptor.manager.email,
      email_confirmed_at: at(1) as string | null,
      id: descriptor.manager.userId,
    },
  };
}

function catalogFixture() {
  return {
    authUserColumns: Object.keys(descriptor.references.authUsers).map((relation) => {
      const [schema, table, column] = relation.split(".");
      return { column, schema, table };
    }),
    organizationColumns: Object.keys(descriptor.references.organizations).map(
      (relation) => {
        const [schema, table] = relation.split(".");
        return { schema, table };
      },
    ),
    schema: "cloxa.preserved-ux-fixture-catalog",
    version: 1,
  };
}

function referenceRows(values: Readonly<Record<string, number>>) {
  return Object.entries(values).map(([relation, count]) => ({ count, relation }));
}

function auditEvent(
  id: string,
  values: {
    action: string;
    actorUserId: string;
    afterData: unknown;
    beforeData?: unknown;
    entityId: string;
    entityType: string;
  },
  createdAt: string,
) {
  return {
    actorType: "user",
    beforeData: null,
    createdAt,
    id,
    organizationId: descriptor.organization.id,
    ...values,
  };
}

function snapshotFixture() {
  const firstBreak = {
    createdAt: at(20),
    endedAt: at(30),
    id: descriptor.breakIds[0],
    membershipId: descriptor.employee.membershipId,
    organizationId: descriptor.organization.id,
    origin: "live",
    startedAt: at(20),
    timeEntryId: descriptor.timeEntryId,
    version: 2,
    worksiteId: descriptor.worksite.id,
  };
  const secondBreak = {
    ...firstBreak,
    createdAt: at(40),
    endedAt: at(50),
    id: descriptor.breakIds[1],
    startedAt: at(40),
  };
  const operation = (
    requestId: string,
    breakRecord: typeof firstBreak,
    ending: boolean,
  ) => ({
    membershipId: descriptor.employee.membershipId,
    operation: ending ? "end_break" : "start_break",
    organizationId: descriptor.organization.id,
    payloadMatches: true,
    processedAt: ending ? breakRecord.endedAt : breakRecord.startedAt,
    requestId,
    result: {
      break_id: breakRecord.id,
      did_transition: true,
      ended_at: ending ? breakRecord.endedAt : null,
      request_id: requestId,
      result_code: ending ? "ended" : "started",
      started_at: breakRecord.startedAt,
      time_entry_id: descriptor.timeEntryId,
      version: ending ? 2 : 1,
    },
  });
  return {
    auditEvents: [
      auditEvent(
        descriptor.auditEventIds[0],
        {
          action: "manager_mfa.registered",
          actorUserId: descriptor.manager.userId,
          afterData: { factor_type: "totp", state: "registered" },
          entityId: descriptor.manager.membershipId,
          entityType: "manager_mfa",
        },
        at(4),
      ),
      auditEvent(
        descriptor.auditEventIds[1],
        {
          action: "employee_invitation.created",
          actorUserId: descriptor.manager.userId,
          afterData: { role: "employee", status: "pending" },
          entityId: descriptor.invitationId,
          entityType: "invitation",
        },
        at(6),
      ),
      auditEvent(
        descriptor.auditEventIds[2],
        {
          action: "employee_invitation.accepted",
          actorUserId: descriptor.employee.userId,
          afterData: {
            membership_id: descriptor.employee.membershipId,
            status: "accepted",
          },
          entityId: descriptor.invitationId,
          entityType: "invitation",
        },
        at(8),
      ),
      auditEvent(
        descriptor.auditEventIds[3],
        {
          action: "time_entry.clocked_in",
          actorUserId: descriptor.employee.userId,
          afterData: { state: "working" },
          entityId: descriptor.timeEntryId,
          entityType: "time_entry",
        },
        at(10),
      ),
      auditEvent(
        descriptor.auditEventIds[4],
        {
          action: "time_break.started",
          actorUserId: descriptor.employee.userId,
          afterData: {
            break_id: firstBreak.id,
            ended_at: null,
            started_at: firstBreak.startedAt,
            status: "open",
            time_entry_id: descriptor.timeEntryId,
            version: 1,
          },
          entityId: firstBreak.id,
          entityType: "time_break",
        },
        firstBreak.startedAt,
      ),
      auditEvent(
        descriptor.auditEventIds[5],
        {
          action: "time_break.ended",
          actorUserId: descriptor.employee.userId,
          afterData: {
            break_id: firstBreak.id,
            ended_at: firstBreak.endedAt,
            started_at: firstBreak.startedAt,
            status: "closed",
            time_entry_id: descriptor.timeEntryId,
            version: 2,
          },
          entityId: firstBreak.id,
          entityType: "time_break",
        },
        firstBreak.endedAt,
      ),
      auditEvent(
        descriptor.auditEventIds[6],
        {
          action: "time_break.started",
          actorUserId: descriptor.employee.userId,
          afterData: {
            break_id: secondBreak.id,
            ended_at: null,
            started_at: secondBreak.startedAt,
            status: "open",
            time_entry_id: descriptor.timeEntryId,
            version: 1,
          },
          entityId: secondBreak.id,
          entityType: "time_break",
        },
        secondBreak.startedAt,
      ),
      auditEvent(
        descriptor.auditEventIds[7],
        {
          action: "time_break.ended",
          actorUserId: descriptor.employee.userId,
          afterData: {
            break_id: secondBreak.id,
            ended_at: secondBreak.endedAt,
            started_at: secondBreak.startedAt,
            status: "closed",
            time_entry_id: descriptor.timeEntryId,
            version: 2,
          },
          entityId: secondBreak.id,
          entityType: "time_break",
        },
        secondBreak.endedAt,
      ),
      auditEvent(
        descriptor.auditEventIds[8],
        {
          action: "time_entry.clocked_out",
          actorUserId: descriptor.employee.userId,
          afterData: { state: "stopped" },
          beforeData: { state: "working" },
          entityId: descriptor.timeEntryId,
          entityType: "time_entry",
        },
        at(60),
      ),
    ],
    breakCorrectionRequests: 0,
    breakOperations: [
      operation(descriptor.breakOperationIds[0], firstBreak, false),
      operation(descriptor.breakOperationIds[1], firstBreak, true),
      operation(descriptor.breakOperationIds[2], secondBreak, false),
      operation(descriptor.breakOperationIds[3], secondBreak, true),
    ],
    breakRevisions: 0,
    breaks: [firstBreak, secondBreak],
    clockRequests: [
      {
        endedAt: null,
        membershipId: descriptor.employee.membershipId,
        operation: "clock_in",
        processedAt: at(10),
        requestId: descriptor.clockRequestIds[0],
        resultCode: "started",
        startedAt: at(10),
        timeEntryId: descriptor.timeEntryId,
        worksiteId: descriptor.worksite.id,
      },
      {
        endedAt: at(60),
        membershipId: descriptor.employee.membershipId,
        operation: "clock_out",
        processedAt: at(60),
        requestId: descriptor.clockRequestIds[1],
        resultCode: "stopped",
        startedAt: at(10),
        timeEntryId: descriptor.timeEntryId,
        worksiteId: descriptor.worksite.id,
      },
    ],
    entryCorrectionRequests: 0,
    factors: [
      {
        createdAt: at(3),
        factorType: "totp",
        id: descriptor.factorId,
        status: "verified",
        userId: descriptor.manager.userId,
      },
    ],
    invitations: [
      {
        acceptedAt: at(8),
        acceptedBy: descriptor.employee.userId,
        createdAt: at(6),
        displayName: descriptor.employee.displayName,
        email: descriptor.employee.email,
        employeeCode: descriptor.employee.code,
        expiresAt: at(86_400_006),
        id: descriptor.invitationId,
        invitedBy: descriptor.manager.userId,
        organizationId: descriptor.organization.id,
        revokedAt: null,
        role: "employee",
        status: "accepted",
      },
    ],
    memberships: [
      {
        createdAt: at(2),
        employeeCode: descriptor.employee.code,
        id: descriptor.employee.membershipId,
        organizationId: descriptor.organization.id,
        role: "employee",
        status: "active",
        userId: descriptor.employee.userId,
      },
      {
        createdAt: at(1),
        employeeCode: null,
        id: descriptor.manager.membershipId,
        organizationId: descriptor.organization.id,
        role: "manager",
        status: "active",
        userId: descriptor.manager.userId,
      },
    ],
    mfaRegistrations: [
      {
        authUserId: descriptor.manager.userId,
        factorId: descriptor.factorId,
        generation: 1,
        registeredAt: at(4),
        sessionCutoffAt: null,
      },
    ],
    organization: {
      createdAt: boundary,
      id: descriptor.organization.id,
      lifecycleStatus: descriptor.organization.lifecycleStatus,
      name: descriptor.organization.name,
    },
    profiles: [
      {
        createdAt: at(2),
        displayName: descriptor.employee.displayName,
        locale: "nl-BE",
        userId: descriptor.employee.userId,
      },
      {
        createdAt: at(1),
        displayName: descriptor.manager.displayName,
        locale: "nl-BE",
        userId: descriptor.manager.userId,
      },
    ],
    references: {
      authUsers: referenceRows(descriptor.references.authUsers),
      organizations: referenceRows(descriptor.references.organizations),
    },
    schema: "cloxa.preserved-ux-fixture-snapshot",
    timeEntries: [
      {
        createdAt: at(10),
        endedAt: at(60),
        id: descriptor.timeEntryId,
        lastCorrectionRequestId: null,
        membershipId: descriptor.employee.membershipId,
        organizationId: descriptor.organization.id,
        origin: "clock",
        startedAt: at(10),
        version: 1,
        worksiteId: descriptor.worksite.id,
      },
    ],
    version: 1,
    worksites: [
      {
        createdAt: at(1),
        id: descriptor.worksite.id,
        name: descriptor.worksite.name,
        organizationId: descriptor.organization.id,
        timezone: descriptor.worksite.timezone,
      },
    ],
  };
}

function leaseFixture() {
  return reconstructPreservedFixtureLease(authFixture());
}

function fakeEvidence(events: string[] = []) {
  return {
    checkpoint: vi.fn(async (phase: string) => events.push(`evidence:${phase}`)),
    complete: vi.fn(async () => events.push("evidence:cleaned")),
    fail: vi.fn(async () => events.push("evidence:failed")),
    path: path.join(tmpdir(), "synthetic-preserved-recovery.json"),
    state: vi.fn(),
  };
}

function executionFixture({ snapshot = snapshotFixture() } = {}) {
  const auth = authFixture();
  const events: string[] = [];
  const deleted = new Set<string>();
  const store = {
    deleteUser: vi.fn(async (userId: string) => {
      events.push(`delete:${userId}`);
      deleted.add(userId);
    }),
    getUser: vi.fn(async (userId: string) => {
      if (deleted.has(userId)) throw new LocalAuthError("synthetic user absent");
      return userId === descriptor.manager.userId
        ? auth.managerUser
        : auth.employeeUser;
    }),
    listFactors: vi.fn(async (userId: string) =>
      userId === descriptor.manager.userId ? auth.managerFactors : auth.employeeFactors,
    ),
  };
  const database = {
    cleanup: vi.fn(async () => {
      events.push("database:cleanup");
      return { status: "database_cleaned", triggerState: "enabled" };
    }),
    read: vi.fn(async (sql: string) =>
      sql.includes("cloxa.preserved-ux-fixture-catalog") ? catalogFixture() : snapshot,
    ),
  };
  const evidence = fakeEvidence(events);
  return {
    database,
    deleted,
    events,
    evidence,
    evidenceFactory: vi.fn(async () => evidence),
    store,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("preserved fixture recovery confirmations", () => {
  it("accepts only all six exact confirmations", () => {
    expect(parsed()).toEqual({
      employeeUserId: descriptor.employee.userId,
      managerUserId: descriptor.manager.userId,
      organizationId: descriptor.organization.id,
      preservationSha256: descriptor.preservationSha256,
      runId: descriptor.runId,
    });

    for (let index = 0; index < confirmedArgs().length; index += 1) {
      expect(() =>
        parsePreservedFixtureRecoveryArguments(
          confirmedArgs().filter((_value, candidate) => candidate !== index),
        ),
      ).toThrow("No mutation was attempted");
    }
    for (const flag of [
      "--confirm-run",
      "--confirm-organization",
      "--confirm-manager-user",
      "--confirm-employee-user",
      "--confirm-preservation-sha256",
    ]) {
      const args = confirmedArgs();
      args[args.indexOf(flag) + 1] =
        flag === "--confirm-preservation-sha256" ? "0".repeat(64) : otherUuid;
      expect(() => parsePreservedFixtureRecoveryArguments(args)).toThrow(
        "No mutation was attempted",
      );
    }
  });
});

describe("preserved fixture identity proof", () => {
  it("derives the tight creation boundary only from exact shared server metadata", () => {
    const lease = leaseFixture();
    expect(lease.startedAt).toBe(boundary);
    expect(lease.proof).toBe(proof);
    expect(lease.manager.state).toBe("owned");
    expect(lease.employee.state).toBe("owned");
  });

  it("refuses every manager and employee identity or metadata mismatch", () => {
    const mutations: Array<(value: ReturnType<typeof authFixture>) => void> = [
      (value) => void (value.managerUser.id = otherUuid),
      (value) => void (value.employeeUser.id = otherUuid),
      (value) => void (value.managerUser.email = "other.manager@example.test"),
      (value) => void (value.employeeUser.email = "other.employee@example.test"),
      (value) => void (value.managerUser.app_metadata.cloxa_local_fixture = "wrong"),
      (value) => void (value.employeeUser.app_metadata.cloxa_local_fixture = "wrong"),
      (value) =>
        void (value.managerUser.app_metadata.cloxa_local_fixture_run_id = otherUuid),
      (value) =>
        void (value.employeeUser.app_metadata.cloxa_local_fixture_run_id = otherUuid),
      (value) =>
        void (value.managerUser.app_metadata.cloxa_local_fixture_organization_id =
          otherUuid),
      (value) =>
        void (value.employeeUser.app_metadata.cloxa_local_fixture_organization_id =
          otherUuid),
      (value) =>
        void (value.managerUser.app_metadata.cloxa_local_fixture_role = "employee"),
      (value) =>
        void (value.employeeUser.app_metadata.cloxa_local_fixture_role = "manager"),
      (value) =>
        void (value.employeeUser.app_metadata.cloxa_local_fixture_proof = otherUuid),
      (value) => void (value.managerUser.created_at = "invalid"),
      (value) => void (value.employeeUser.created_at = at(-1)),
      (value) => void (value.managerUser.created_at = null as never),
      (value) => void (value.managerUser.email_confirmed_at = at(-1)),
      (value) => void (value.employeeUser.email_confirmed_at = at(-1)),
      (value) => void (value.employeeUser.invited_at = at(-1)),
      (value) => void (value.managerUser.email_confirmed_at = null),
      (value) => void (value.employeeUser.email_confirmed_at = null),
      (value) => void (value.employeeUser.invited_at = null),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(authFixture());
      mutate(value);
      expect(() => reconstructPreservedFixtureLease(value)).toThrow(
        "No mutation was attempted",
      );
    }
  });

  it("refuses missing, multiple, wrong, or employee MFA factors", () => {
    const mutations: Array<(value: ReturnType<typeof authFixture>) => void> = [
      (value) => void (value.managerFactors = []),
      (value) => void value.managerFactors.push({ ...value.managerFactors[0] }),
      (value) => void (value.managerFactors[0]!.id = otherUuid),
      (value) => void (value.managerFactors[0]!.factor_type = "phone"),
      (value) => void (value.managerFactors[0]!.status = "unverified"),
      (value) =>
        void value.employeeFactors.push({
          factor_type: "totp",
          id: otherUuid,
          status: "verified",
        }),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(authFixture());
      mutate(value);
      expect(() => reconstructPreservedFixtureLease(value)).toThrow(
        "No mutation was attempted",
      );
    }
  });
});

describe("preserved fixture exact snapshot", () => {
  it("accepts the complete diagnosed graph and builds read-only catalog/snapshot SQL", () => {
    const catalog = validatePreservedFixtureCatalog(catalogFixture());
    const snapshot = snapshotFixture();
    expect(validatePreservedFixtureSnapshot(snapshot, leaseFixture())).toBe(snapshot);
    const catalogSql = buildPreservedFixtureCatalogSql();
    const snapshotSql = buildPreservedFixtureSnapshotSql(catalog);
    expect(catalogSql).toContain("begin read only;");
    expect(snapshotSql).toContain("begin read only;");
    expect(snapshotSql).toContain(descriptor.auditEventIds[8]);
    expect(snapshotSql).not.toMatch(/delete\s+from/iu);
  });

  it("refuses every individual recovered identifier mismatch", () => {
    const mutations: Array<(value: ReturnType<typeof snapshotFixture>) => void> = [
      (value) => void (value.organization.id = otherUuid),
      (value) => void (value.worksites[0]!.id = otherUuid),
      (value) => void (value.profiles[0]!.userId = otherUuid),
      (value) => void (value.profiles[1]!.userId = otherUuid),
      (value) => void (value.memberships[0]!.id = otherUuid),
      (value) => void (value.memberships[1]!.id = otherUuid),
      (value) => void (value.invitations[0]!.id = otherUuid),
      (value) => void (value.timeEntries[0]!.id = otherUuid),
      (value) => void (value.breaks[0]!.id = otherUuid),
      (value) => void (value.breaks[1]!.id = otherUuid),
      (value) => void (value.clockRequests[0]!.requestId = otherUuid),
      (value) => void (value.clockRequests[1]!.requestId = otherUuid),
      ...descriptor.breakOperationIds.map(
        (_id, index) => (value: ReturnType<typeof snapshotFixture>) =>
          void (value.breakOperations[index]!.requestId = otherUuid),
      ),
      ...descriptor.auditEventIds.map(
        (_id, index) => (value: ReturnType<typeof snapshotFixture>) =>
          void (value.auditEvents[index]!.id = otherUuid),
      ),
      (value) => void (value.factors[0]!.id = otherUuid),
      (value) => void (value.mfaRegistrations[0]!.authUserId = otherUuid),
      (value) => void (value.mfaRegistrations[0]!.factorId = otherUuid),
    ];
    expect(mutations).toHaveLength(28);
    for (const mutate of mutations) {
      const value = structuredClone(snapshotFixture());
      mutate(value);
      expect(() => validatePreservedFixtureSnapshot(value, leaseFixture())).toThrow(
        "No mutation was attempted",
      );
    }
  });

  it("refuses every cardinality in the recovery matrix when changed", () => {
    const mutations: Array<(value: ReturnType<typeof snapshotFixture>) => void> = [
      (value) => void (value.organization = null as never),
      (value) => void value.worksites.pop(),
      (value) => void value.profiles.pop(),
      (value) => void value.memberships.pop(),
      (value) => void value.invitations.pop(),
      (value) => void value.timeEntries.pop(),
      (value) => void value.breaks.pop(),
      (value) => void value.clockRequests.pop(),
      (value) => void value.breakOperations.pop(),
      (value) => void value.auditEvents.pop(),
      (value) => void value.factors.pop(),
      (value) => void value.mfaRegistrations.pop(),
      (value) => void (value.entryCorrectionRequests = 1),
      (value) => void (value.breakCorrectionRequests = 1),
      (value) => void (value.breakRevisions = 1),
      (value) =>
        void value.references.organizations.push({
          count: 1,
          relation: "private.future_unknown_table",
        }),
      (value) =>
        void value.references.authUsers.push({
          count: 1,
          relation: "private.future_unknown_table.auth_user_id",
        }),
    ];
    expect(mutations).toHaveLength(Object.keys(descriptor.cardinalities).length);
    for (const mutate of mutations) {
      const value = structuredClone(snapshotFixture());
      mutate(value);
      expect(() => validatePreservedFixtureSnapshot(value, leaseFixture())).toThrow(
        "No mutation was attempted",
      );
    }
  });

  it("refuses every factual timestamp boundary and key graph relationship", () => {
    const earlier = at(-1);
    const mutations: Array<(value: ReturnType<typeof snapshotFixture>) => void> = [
      (value) => void (value.organization.createdAt = earlier),
      (value) => void (value.worksites[0]!.createdAt = earlier),
      (value) => void (value.profiles[0]!.createdAt = earlier),
      (value) => void (value.profiles[1]!.createdAt = earlier),
      (value) => void (value.memberships[0]!.createdAt = earlier),
      (value) => void (value.memberships[1]!.createdAt = earlier),
      (value) => void (value.invitations[0]!.createdAt = earlier),
      (value) => void (value.invitations[0]!.acceptedAt = earlier),
      (value) => void (value.timeEntries[0]!.createdAt = earlier),
      (value) => void (value.timeEntries[0]!.startedAt = earlier),
      (value) => void (value.timeEntries[0]!.endedAt = earlier),
      (value) => void (value.breaks[0]!.createdAt = earlier),
      (value) => void (value.breaks[0]!.startedAt = earlier),
      (value) => void (value.breaks[0]!.endedAt = earlier),
      (value) => void (value.breaks[1]!.createdAt = earlier),
      (value) => void (value.breaks[1]!.startedAt = earlier),
      (value) => void (value.breaks[1]!.endedAt = earlier),
      (value) => void (value.clockRequests[0]!.processedAt = earlier),
      (value) => void (value.clockRequests[1]!.processedAt = earlier),
      ...[0, 1, 2, 3].map(
        (index) => (value: ReturnType<typeof snapshotFixture>) =>
          void (value.breakOperations[index]!.processedAt = earlier),
      ),
      ...descriptor.auditEventIds.map(
        (_id, index) => (value: ReturnType<typeof snapshotFixture>) =>
          void (value.auditEvents[index]!.createdAt = earlier),
      ),
      (value) => void (value.factors[0]!.createdAt = earlier),
      (value) => void (value.mfaRegistrations[0]!.registeredAt = earlier),
      (value) => void (value.breakOperations[0]!.payloadMatches = false),
      (value) => void (value.auditEvents[0]!.afterData = { state: "other" }),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(snapshotFixture());
      mutate(value);
      expect(() => validatePreservedFixtureSnapshot(value, leaseFixture())).toThrow(
        "No mutation was attempted",
      );
    }
  });

  it("refuses missing or multiple manager registrations and factor rows", () => {
    for (const mutate of [
      (value: ReturnType<typeof snapshotFixture>) => void value.factors.pop(),
      (value: ReturnType<typeof snapshotFixture>) =>
        void value.factors.push({ ...value.factors[0]!, id: otherUuid }),
      (value: ReturnType<typeof snapshotFixture>) => void value.mfaRegistrations.pop(),
      (value: ReturnType<typeof snapshotFixture>) =>
        void value.mfaRegistrations.push({
          ...value.mfaRegistrations[0]!,
          authUserId: descriptor.employee.userId,
        }),
    ]) {
      const value = structuredClone(snapshotFixture());
      mutate(value);
      expect(() => validatePreservedFixtureSnapshot(value, leaseFixture())).toThrow(
        "No mutation was attempted",
      );
    }
  });
});

describe("preserved fixture cleanup orchestration", () => {
  it("injects exact proof under generic locks without broad manual deletion", () => {
    const sql = buildPreservedFixtureCleanupSql(leaseFixture());
    const locks = sql.indexOf("lock table %I.%I in %s mode");
    const exactProof = sql.indexOf("preserved_fixture_exact_snapshot_unverified");
    const firstMutation = sql.indexOf("disable trigger time_break_operation_immutable");
    expect(locks).toBeGreaterThan(-1);
    expect(exactProof).toBeGreaterThan(locks);
    expect(firstMutation).toBeGreaterThan(exactProof);
    expect(sql).toContain(descriptor.auditEventIds[8]);
    expect(sql).toContain("'triggerState', 'enabled'");
    expect(sql).not.toContain("buildLocalAuthCleanupSql");
    expect(sql).not.toContain("delete from auth.mfa_factors");
    expect(sql.match(/delete from public\.organizations/giu)).toHaveLength(1);
  });

  it("performs no mutation before all identity, catalog, and snapshot proof succeeds", async () => {
    const value = snapshotFixture();
    value.auditEvents.pop();
    const fixture = executionFixture({ snapshot: value });

    await expect(executePreservedFixtureRecovery(parsed(), fixture)).rejects.toThrow(
      "No mutation was attempted",
    );
    expect(fixture.database.cleanup).not.toHaveBeenCalled();
    expect(fixture.store.deleteUser).not.toHaveBeenCalled();
    expect(fixture.evidenceFactory).not.toHaveBeenCalled();
  });

  it("stops Auth deletion when cleanup cannot prove restored trigger state", async () => {
    const fixture = executionFixture();
    fixture.database.cleanup.mockResolvedValueOnce({
      status: "database_cleaned",
      triggerState: "unknown",
    });

    await expect(executePreservedFixtureRecovery(parsed(), fixture)).rejects.toThrow(
      "remaining resources preserved",
    );
    expect(fixture.store.deleteUser).not.toHaveBeenCalled();
    expect(fixture.evidence.fail).toHaveBeenCalledOnce();
  });

  it("completes exact database cleanup before employee and manager Auth deletion", async () => {
    const fixture = executionFixture();
    await expect(executePreservedFixtureRecovery(parsed(), fixture)).resolves.toEqual(
      expect.objectContaining({
        organizationId: descriptor.organization.id,
        runId: descriptor.runId,
        status: "cleaned",
      }),
    );
    expect(fixture.events.indexOf("database:cleanup")).toBeLessThan(
      fixture.events.indexOf("evidence:triggers_confirmed_enabled"),
    );
    expect(fixture.events.indexOf("evidence:triggers_confirmed_enabled")).toBeLessThan(
      fixture.events.indexOf("evidence:database_cleaned"),
    );
    expect(fixture.events.indexOf("evidence:database_cleaned")).toBeLessThan(
      fixture.events.indexOf(`delete:${descriptor.employee.userId}`),
    );
    expect(fixture.events.indexOf(`delete:${descriptor.employee.userId}`)).toBeLessThan(
      fixture.events.indexOf(`delete:${descriptor.manager.userId}`),
    );
    expect(fixture.evidence.complete).toHaveBeenCalledOnce();
    expect(fixture.evidence.fail).not.toHaveBeenCalled();
  });

  it("retains exact protected evidence after simulated database failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cloxa-preserved-recovery-test-"));
    const fixture = executionFixture();
    fixture.database.cleanup.mockRejectedValueOnce(new Error("synthetic failure"));
    const evidencePath = path.join(
      root,
      "cloxa-preserved-fixture-recovery",
      descriptor.runId,
      "recovery.json",
    );
    try {
      await expect(
        executePreservedFixtureRecovery(parsed(), {
          ...fixture,
          evidenceFactory: ({ lease }) =>
            createPreservedFixtureRecoveryEvidence({ lease, temporaryRoot: root }),
        }),
      ).rejects.toThrow("remaining resources preserved");
      const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      expect(evidence).toMatchObject({
        currentPhase: "proof_confirmed",
        resourcesRemaining: true,
        schema: "cloxa.preserved-ux-fixture-recovery",
        status: "failed",
        version: 1,
      });
      expect(evidence.lease).toMatchObject({
        employeeUserId: descriptor.employee.userId,
        managerUserId: descriptor.manager.userId,
        organizationId: descriptor.organization.id,
        proofStatus: "retained_for_recovery",
        runId: descriptor.runId,
      });
      expect(evidence.lease.proof).toBe(proof);
      await expect(access(`${evidencePath}.next`)).rejects.toThrow();
      expect(fixture.store.deleteUser).not.toHaveBeenCalled();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("records trigger, database, and Auth boundaries separately on partial failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cloxa-preserved-recovery-test-"));
    const fixture = executionFixture();
    fixture.store.deleteUser.mockRejectedValueOnce(new Error("synthetic failure"));
    const evidencePath = path.join(
      root,
      "cloxa-preserved-fixture-recovery",
      descriptor.runId,
      "recovery.json",
    );
    try {
      await expect(
        executePreservedFixtureRecovery(parsed(), {
          ...fixture,
          evidenceFactory: ({ lease }) =>
            createPreservedFixtureRecoveryEvidence({ lease, temporaryRoot: root }),
        }),
      ).rejects.toThrow("remaining resources preserved");
      const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      expect(evidence).toMatchObject({
        confirmations: {
          databaseCleaned: true,
          employeeAuthDeleted: false,
          managerAuthDeleted: false,
          snapshotProven: true,
          triggersConfirmedEnabled: true,
        },
        currentPhase: "database_cleaned",
        resourcesRemaining: true,
        status: "failed",
      });
      expect(evidence.checkpoints.map(({ phase }: { phase: string }) => phase)).toEqual(
        ["proof_confirmed", "triggers_confirmed_enabled", "database_cleaned", "failed"],
      );
      expect(evidence.lease.proof).toBe(proof);
      expect(fixture.store.deleteUser).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("redacts ownership proof only after complete cleanup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cloxa-preserved-recovery-test-"));
    const fixture = executionFixture();
    const evidencePath = path.join(
      root,
      "cloxa-preserved-fixture-recovery",
      descriptor.runId,
      "recovery.json",
    );
    try {
      await executePreservedFixtureRecovery(parsed(), {
        ...fixture,
        evidenceFactory: ({ lease }) =>
          createPreservedFixtureRecoveryEvidence({ lease, temporaryRoot: root }),
      });
      const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      expect(evidence).toMatchObject({
        confirmations: {
          databaseCleaned: true,
          employeeAuthDeleted: true,
          managerAuthDeleted: true,
          snapshotProven: true,
          triggersConfirmedEnabled: true,
        },
        currentPhase: "cleaned",
        resourcesRemaining: false,
        status: "cleaned",
      });
      expect(evidence.lease).toMatchObject({
        proof: null,
        proofStatus: "redacted_after_cleanup",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("cannot mutate broadly on a second invocation after successful cleanup", async () => {
    const fixture = executionFixture();
    await executePreservedFixtureRecovery(parsed(), fixture);
    await expect(executePreservedFixtureRecovery(parsed(), fixture)).rejects.toThrow(
      "synthetic user absent",
    );
    expect(fixture.database.cleanup).toHaveBeenCalledOnce();
    expect(fixture.store.deleteUser).toHaveBeenCalledTimes(2);
  });
});
