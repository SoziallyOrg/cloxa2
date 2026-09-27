import { randomUUID } from "node:crypto";

import {
  localOnlyFetch,
  LocalAuthError,
  requireFictionalEmail,
} from "./local-auth-config.mjs";
import { runOperatorSql } from "./local-manager-mfa-recovery.mjs";

export const localAuthE2eFixtureMarker = "cloxa-local-auth-e2e-v1";

const retainedManagerMarker = "cloxa-local-manager-v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stateValues = new Set(["planned", "uncertain", "owned", "deleted"]);
const leaseOperations = new WeakMap();

export const localAuthFixtureDeadlines = Object.freeze({
  operationMs: 120_000,
  requestMs: 10_000,
  sqlMs: 25_000,
});

function cancellationError() {
  return new LocalAuthError(
    "Local Auth E2E operation was cancelled. Unconfirmed resources were preserved.",
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError();
}

function leaseSignal(lease, signal) {
  return signal ?? leaseOperations.get(lease)?.signal;
}

export function createLocalAuthE2eOperation(
  lease,
  {
    clearTimer = clearTimeout,
    controller = new AbortController(),
    setTimer = setTimeout,
    timeoutMs,
  } = {},
) {
  assertLease(lease);
  const existing = leaseOperations.get(lease);
  if (existing) return existing;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new LocalAuthError("Local Auth E2E operation deadline is invalid.");
  }
  let timer;
  const operation = {
    abort() {
      if (timer !== undefined) clearTimer(timer);
      if (!controller.signal.aborted) controller.abort();
    },
    finish() {
      if (timer !== undefined) clearTimer(timer);
      if (leaseOperations.get(lease) === operation) leaseOperations.delete(lease);
    },
    signal: controller.signal,
  };
  if (timeoutMs !== undefined) timer = setTimer(() => operation.abort(), timeoutMs);
  leaseOperations.set(lease, operation);
  return operation;
}

export function createLocalAuthFixtureFetch({
  clearTimer = clearTimeout,
  fetchImplementation = localOnlyFetch,
  requestTimeoutMs = localAuthFixtureDeadlines.requestMs,
  setTimer = setTimeout,
  signal,
} = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new LocalAuthError("Local Auth E2E request deadline is invalid.");
  }
  return async (input, init = {}) => {
    const requestController = new AbortController();
    const sourceSignals = [...new Set([signal, init.signal].filter(Boolean))];
    const forwardedSignals = [];
    const abortRequest = () => requestController.abort();
    for (const source of sourceSignals) {
      if (source.aborted) abortRequest();
      else {
        source.addEventListener("abort", abortRequest, { once: true });
        forwardedSignals.push(source);
      }
    }
    const timer = setTimer(abortRequest, requestTimeoutMs);
    let responseLifecycleOwnsRelease = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimer(timer);
      for (const source of forwardedSignals) {
        source.removeEventListener("abort", abortRequest);
      }
    };
    try {
      throwIfAborted(requestController.signal);
      const response = await fetchImplementation(input, {
        ...init,
        redirect: "error",
        signal: requestController.signal,
      });
      throwIfAborted(requestController.signal);
      if (!response?.body) return response;
      const bridge = new TransformStream();
      const wrappedResponse = new Response(bridge.readable, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
      const lifecycle = response.body.pipeTo(bridge.writable, {
        signal: requestController.signal,
      });
      responseLifecycleOwnsRelease = true;
      void lifecycle.then(release, release);
      return wrappedResponse;
    } finally {
      if (!responseLifecycleOwnsRelease) release();
    }
  };
}

function ownershipError() {
  return new LocalAuthError(
    "Local Auth E2E ownership could not be proven. No cleanup was attempted.",
  );
}

function operationError(label) {
  return new LocalAuthError(
    `Local Auth E2E ${label} failed. Private fixture details were withheld.`,
  );
}

function requireUuid(value, label) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalAuthError(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function requireIsoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new LocalAuthError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function requireState(value) {
  if (!stateValues.has(value)) throw ownershipError();
  return value;
}

function sqlText(value) {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value)) throw ownershipError();
  return `'${value.replaceAll("'", "''")}'`;
}

function userMetadata(lease, role) {
  return {
    cloxa_local_fixture: localAuthE2eFixtureMarker,
    cloxa_local_fixture_organization_id: lease.organization.id,
    cloxa_local_fixture_proof: lease.proof,
    cloxa_local_fixture_role: role,
    cloxa_local_fixture_run_id: lease.runId,
  };
}

function expectedEmail(lease, role) {
  return role === "manager" ? lease.manager.email : lease.employee.email;
}

function createdDuringRun(value, lease) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) >= Date.parse(lease.startedAt)
  );
}

function assertExactRecord(record, expected) {
  if (
    !record ||
    typeof record !== "object" ||
    Object.entries(expected).some(([key, value]) => record[key] !== value)
  ) {
    throw ownershipError();
  }
  return record;
}

function assertLease(lease) {
  if (!lease || typeof lease !== "object") throw ownershipError();
  requireUuid(lease.runId, "Fixture run ID");
  requireUuid(lease.proof, "Fixture ownership proof");
  requireUuid(lease.organization?.id, "Fixture organization ID");
  requireUuid(lease.worksite?.id, "Fixture worksite ID");
  requireUuid(lease.managerMembership?.id, "Fixture manager membership ID");
  requireIsoTimestamp(lease.startedAt, "Fixture start");
  requireFictionalEmail(lease.manager?.email);
  requireFictionalEmail(lease.employee?.email);
  requireState(lease.manager?.state);
  requireState(lease.employee?.state);
  requireState(lease.organization?.state);
  requireState(lease.worksite?.state);
  requireState(lease.managerMembership?.state);
  requireState(lease.managerProfile?.state);
  if (
    lease.marker !== localAuthE2eFixtureMarker ||
    lease.organization.name !== `Local Auth E2E ${lease.runId}` ||
    lease.worksite.name !== `Local Auth E2E ${lease.runId}` ||
    lease.employee.code !==
      `E2E-${lease.runId.replaceAll("-", "").slice(0, 20).toUpperCase()}` ||
    lease.employee.displayName !== "Fictieve medewerker"
  ) {
    throw ownershipError();
  }
  return lease;
}

export function createLocalAuthE2eLease({
  createId = randomUUID,
  now = () => new Date(),
} = {}) {
  const runId = requireUuid(createId(), "Fixture run ID");
  const proof = requireUuid(createId(), "Fixture ownership proof");
  const organizationId = requireUuid(createId(), "Fixture organization ID");
  const worksiteId = requireUuid(createId(), "Fixture worksite ID");
  const managerMembershipId = requireUuid(createId(), "Fixture manager membership ID");
  const startedAt = now().toISOString();

  return {
    cleanup: { database: "pending" },
    employee: {
      code: `E2E-${runId.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
      displayName: "Fictieve medewerker",
      email: requireFictionalEmail(`local-auth.employee.${runId}@example.test`),
      emailAbsent: false,
      invitationAttempted: false,
      invitationId: null,
      state: "planned",
      userId: null,
    },
    manager: {
      email: requireFictionalEmail(`local-auth.manager.${runId}@example.test`),
      emailAbsent: false,
      state: "planned",
      userId: null,
    },
    managerMembership: { id: managerMembershipId, state: "planned" },
    managerProfile: { state: "planned" },
    marker: localAuthE2eFixtureMarker,
    organization: {
      id: organizationId,
      name: `Local Auth E2E ${runId}`,
      state: "planned",
    },
    proof,
    runId,
    startedAt,
    worksite: {
      id: worksiteId,
      name: `Local Auth E2E ${runId}`,
      state: "planned",
    },
  };
}

function requireStoreResult(result, label) {
  if (result?.error || result?.data === null || result?.data === undefined) {
    throw operationError(label);
  }
  return result.data;
}

export function createSupabaseFixtureStore(admin, { signal } = {}) {
  if (!admin?.auth?.admin || typeof admin.from !== "function") {
    throw new LocalAuthError("Local Auth E2E store is unavailable.");
  }

  return {
    async createRow(table, values) {
      throwIfAborted(signal);
      let query = admin.from(table).insert(values).select("*").single();
      if (signal && typeof query.abortSignal === "function") {
        query = query.abortSignal(signal);
      }
      const result = await query;
      throwIfAborted(signal);
      const data = requireStoreResult(result, `${table} creation`);
      return data;
    },
    async createUser(attributes) {
      throwIfAborted(signal);
      const result = await admin.auth.admin.createUser(attributes);
      throwIfAborted(signal);
      const data = requireStoreResult(result, "account creation");
      return data.user;
    },
    async deleteUser(userId) {
      throwIfAborted(signal);
      const result = await admin.auth.admin.deleteUser(userId);
      throwIfAborted(signal);
      requireStoreResult(result, "account cleanup");
    },
    async findUsersByEmail(email) {
      const matches = [];
      for (let page = 1; page <= 100; page += 1) {
        throwIfAborted(signal);
        const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
        throwIfAborted(signal);
        const data = requireStoreResult(result, "account lookup");
        const users = Array.isArray(data.users) ? data.users : null;
        if (!users) throw operationError("account lookup");
        matches.push(
          ...users.filter((user) => user.email?.toLowerCase() === email.toLowerCase()),
        );
        if (users.length < 100) return matches;
      }
      throw operationError("account lookup limit");
    },
    async getUser(userId) {
      throwIfAborted(signal);
      const result = await admin.auth.admin.getUserById(userId);
      throwIfAborted(signal);
      const data = requireStoreResult(result, "account verification");
      return data.user;
    },
    async listFactors(userId) {
      throwIfAborted(signal);
      const result = await admin.auth.admin.mfa.listFactors({ userId });
      throwIfAborted(signal);
      const data = requireStoreResult(result, "factor verification");
      if (!Array.isArray(data.factors)) throw operationError("factor verification");
      return data.factors;
    },
    async readRows(table, filters) {
      let query = admin.from(table).select("*");
      for (const [field, value] of Object.entries(filters)) {
        query = query.eq(field, value);
      }
      if (signal && typeof query.abortSignal === "function") {
        query = query.abortSignal(signal);
      }
      throwIfAborted(signal);
      const result = await query;
      throwIfAborted(signal);
      const data = requireStoreResult(result, `${table} lookup`);
      if (!Array.isArray(data)) throw operationError(`${table} lookup`);
      return data;
    },
    async updateUser(userId, attributes) {
      throwIfAborted(signal);
      const result = await admin.auth.admin.updateUserById(userId, attributes);
      throwIfAborted(signal);
      const data = requireStoreResult(result, "account ownership claim");
      return data.user;
    },
  };
}

export function assertFixtureUserOwnership(user, lease, role, userId) {
  assertLease(lease);
  const expectedId = requireUuid(userId, "Fixture user ID");
  const metadata = user?.app_metadata;
  const expected = userMetadata(lease, role);
  if (
    !user ||
    user.id !== expectedId ||
    user.email?.toLowerCase() !== expectedEmail(lease, role) ||
    user.deleted_at ||
    !createdDuringRun(user.created_at, lease) ||
    metadata?.cloxa_local_fixture === retainedManagerMarker ||
    Object.entries(expected).some(([key, value]) => metadata?.[key] !== value) ||
    (role === "manager" && !user.email_confirmed_at) ||
    (role === "employee" && !user.invited_at)
  ) {
    throw ownershipError();
  }
  return user;
}

async function assertEmailAbsent(store, email) {
  const matches = await store.findUsersByEmail(email);
  if (!Array.isArray(matches) || matches.length !== 0) throw ownershipError();
}

async function assertRowAbsent(store, table, filters) {
  const rows = await store.readRows(table, filters);
  if (!Array.isArray(rows) || rows.length !== 0) throw ownershipError();
}

async function createOwnedRow(lease, store, resource, table, expected, key) {
  await assertRowAbsent(store, table, { [key]: expected[key] });
  resource.state = "uncertain";
  const created = await store.createRow(table, expected);
  assertExactRecord(created, expected);
  const rows = await store.readRows(table, { [key]: expected[key] });
  if (rows.length !== 1) throw ownershipError();
  assertExactRecord(rows[0], expected);
  resource.state = "owned";
}

export async function provisionLocalAuthManager(lease, { password, store }) {
  assertLease(lease);
  if (
    lease.manager.state !== "planned" ||
    lease.employee.state !== "planned" ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    throw ownershipError();
  }

  await assertEmailAbsent(store, lease.manager.email);
  lease.manager.emailAbsent = true;
  await assertEmailAbsent(store, lease.employee.email);
  lease.employee.emailAbsent = true;

  lease.manager.state = "uncertain";
  const createdUser = await store.createUser({
    app_metadata: userMetadata(lease, "manager"),
    email: lease.manager.email,
    email_confirm: true,
    password,
  });
  if (createdUser?.id && uuidPattern.test(createdUser.id)) {
    lease.manager.userId = createdUser.id.toLowerCase();
  }
  assertFixtureUserOwnership(createdUser, lease, "manager", lease.manager.userId);
  const verifiedUser = await store.getUser(lease.manager.userId);
  assertFixtureUserOwnership(verifiedUser, lease, "manager", lease.manager.userId);
  if ((await store.listFactors(lease.manager.userId)).length !== 0) {
    throw ownershipError();
  }
  lease.manager.state = "owned";

  await createOwnedRow(
    lease,
    store,
    lease.organization,
    "organizations",
    {
      id: lease.organization.id,
      lifecycle_status: "research_pilot",
      name: lease.organization.name,
    },
    "id",
  );
  await createOwnedRow(
    lease,
    store,
    lease.worksite,
    "worksites",
    {
      id: lease.worksite.id,
      name: lease.worksite.name,
      organization_id: lease.organization.id,
      timezone: "Europe/Brussels",
    },
    "id",
  );
  await createOwnedRow(
    lease,
    store,
    lease.managerProfile,
    "profiles",
    {
      display_name: "Fictieve lokale E2E-beheerder",
      locale: "nl-BE",
      user_id: lease.manager.userId,
    },
    "user_id",
  );
  await createOwnedRow(
    lease,
    store,
    lease.managerMembership,
    "memberships",
    {
      employee_code: null,
      id: lease.managerMembership.id,
      organization_id: lease.organization.id,
      role: "manager",
      status: "active",
      user_id: lease.manager.userId,
    },
    "id",
  );
}

export async function prepareLocalAuthEmployeeInvitation(lease, { store }) {
  assertLease(lease);
  if (
    lease.manager.state !== "owned" ||
    lease.managerMembership.state !== "owned" ||
    lease.employee.state !== "planned" ||
    lease.employee.invitationAttempted
  ) {
    throw ownershipError();
  }
  await assertEmailAbsent(store, lease.employee.email);
  lease.employee.emailAbsent = true;
  const invitations = await store.readRows("invitations", {
    normalized_email: lease.employee.email,
    organization_id: lease.organization.id,
  });
  if (invitations.length !== 0) throw ownershipError();
}

export function markLocalAuthInvitationAttempted(lease) {
  assertLease(lease);
  if (!lease.employee.emailAbsent || lease.employee.invitationAttempted) {
    throw ownershipError();
  }
  lease.employee.invitationAttempted = true;
}

function assertInvitationOwnership(invitation, lease) {
  if (
    !invitation ||
    !uuidPattern.test(invitation.id) ||
    invitation.organization_id !== lease.organization.id ||
    invitation.normalized_email !== lease.employee.email ||
    invitation.invited_by !== lease.manager.userId ||
    invitation.intended_role !== "employee" ||
    invitation.status !== "pending" ||
    invitation.accepted_by !== null ||
    invitation.display_name !== lease.employee.displayName ||
    invitation.employee_code !== lease.employee.code ||
    !createdDuringRun(invitation.created_at, lease)
  ) {
    throw ownershipError();
  }
  return invitation;
}

function assertInvitedUserCandidate(user, lease) {
  if (
    !user ||
    !uuidPattern.test(user.id) ||
    user.email?.toLowerCase() !== lease.employee.email ||
    user.deleted_at ||
    !createdDuringRun(user.created_at, lease) ||
    !createdDuringRun(user.invited_at, lease) ||
    user.app_metadata?.cloxa_local_fixture
  ) {
    throw ownershipError();
  }
  return user;
}

export async function claimLocalAuthEmployee(lease, { store }) {
  assertLease(lease);
  if (
    !lease.employee.emailAbsent ||
    !lease.employee.invitationAttempted ||
    lease.employee.state !== "planned"
  ) {
    throw ownershipError();
  }

  assertFixtureUserOwnership(
    await store.getUser(lease.manager.userId),
    lease,
    "manager",
    lease.manager.userId,
  );
  const invitations = await store.readRows("invitations", {
    invited_by: lease.manager.userId,
    normalized_email: lease.employee.email,
    organization_id: lease.organization.id,
  });
  if (invitations.length !== 1) throw ownershipError();
  const invitation = assertInvitationOwnership(invitations[0], lease);
  const users = await store.findUsersByEmail(lease.employee.email);
  if (users.length !== 1) throw ownershipError();
  const candidate = assertInvitedUserCandidate(users[0], lease);
  if (
    (await store.readRows("memberships", { user_id: candidate.id })).length !== 0 ||
    (await store.readRows("profiles", { user_id: candidate.id })).length !== 0
  ) {
    throw ownershipError();
  }

  lease.employee.state = "uncertain";
  lease.employee.userId = candidate.id.toLowerCase();
  lease.employee.invitationId = invitation.id.toLowerCase();
  const claimed = await store.updateUser(lease.employee.userId, {
    app_metadata: {
      ...candidate.app_metadata,
      ...userMetadata(lease, "employee"),
    },
  });
  assertFixtureUserOwnership(claimed, lease, "employee", lease.employee.userId);
  assertFixtureUserOwnership(
    await store.getUser(lease.employee.userId),
    lease,
    "employee",
    lease.employee.userId,
  );
  lease.employee.state = "owned";
}

export async function verifyAcceptedLocalAuthEmployee(lease, { store }) {
  assertLease(lease);
  if (lease.employee.state !== "owned") throw ownershipError();
  const invitations = await store.readRows("invitations", {
    id: lease.employee.invitationId,
  });
  const memberships = await store.readRows("memberships", {
    organization_id: lease.organization.id,
    user_id: lease.employee.userId,
  });
  const profiles = await store.readRows("profiles", {
    user_id: lease.employee.userId,
  });
  if (
    invitations.length !== 1 ||
    invitations[0]?.status !== "accepted" ||
    invitations[0]?.accepted_by !== lease.employee.userId ||
    memberships.length !== 1 ||
    memberships[0]?.role !== "employee" ||
    memberships[0]?.status !== "active" ||
    memberships[0]?.employee_code !== lease.employee.code ||
    profiles.length !== 1 ||
    profiles[0]?.display_name !== lease.employee.displayName ||
    profiles[0]?.locale !== "nl-BE"
  ) {
    throw ownershipError();
  }
}

function userSqlArray(lease) {
  const ids = [lease.manager.userId];
  if (lease.employee.state === "owned") ids.push(lease.employee.userId);
  return `array[${ids.map((id) => `${sqlText(requireUuid(id, "Fixture user ID"))}::uuid`).join(", ")}]`;
}

export function buildLocalAuthCleanupSql(lease) {
  assertLease(lease);
  if (
    lease.manager.state !== "owned" ||
    lease.organization.state === "uncertain" ||
    lease.worksite.state === "uncertain" ||
    lease.managerProfile.state === "uncertain" ||
    lease.managerMembership.state === "uncertain" ||
    (lease.employee.invitationAttempted && lease.employee.state !== "owned")
  ) {
    throw ownershipError();
  }

  const managerId = sqlText(requireUuid(lease.manager.userId, "Manager user ID"));
  const employeeId =
    lease.employee.state === "owned"
      ? sqlText(requireUuid(lease.employee.userId, "Employee user ID"))
      : "null";
  const invitationId =
    lease.employee.state === "owned"
      ? sqlText(requireUuid(lease.employee.invitationId, "Invitation ID"))
      : "null";
  const users = userSqlArray(lease);
  const marker = sqlText(localAuthE2eFixtureMarker);
  const runId = sqlText(lease.runId);
  const proof = sqlText(lease.proof);
  const organizationId = sqlText(lease.organization.id);
  const worksiteId = sqlText(lease.worksite.id);
  const membershipId = sqlText(lease.managerMembership.id);
  const managerEmail = sqlText(lease.manager.email);
  const employeeEmail = sqlText(lease.employee.email);
  const organizationName = sqlText(lease.organization.name);
  const worksiteName = sqlText(lease.worksite.name);
  const employeeName = sqlText(lease.employee.displayName);
  const employeeCode = sqlText(lease.employee.code);
  const startedAt = sqlText(lease.startedAt);

  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '20s';
do $cloxa_local_auth_fixture$
declare
  fixture_users uuid[] := ${users};
  employee_user uuid := ${employeeId}::uuid;
  employee_membership uuid;
  has_rows boolean;
  relation record;
  triggers_ready boolean;
begin
  -- Global cleanup lock order is schema then relation. Tables whose row-delete
  -- triggers must change are locked AccessExclusive immediately; no lock upgrade
  -- occurs after ownership proof.
  for relation in
    select candidate.schema_name, candidate.relation_name,
      case when (candidate.schema_name, candidate.relation_name) in (
        ('private', 'time_break_operations'),
        ('private', 'time_clock_requests'),
        ('public', 'audit_events'),
        ('public', 'time_breaks'),
        ('public', 'time_entries')
      ) then 'access exclusive' else 'share row exclusive' end as lock_mode
    from (
      values
        ('auth'::name, 'mfa_factors'::name),
        ('auth'::name, 'users'::name),
        ('private'::name, 'manager_mfa_registrations'::name),
        ('private'::name, 'time_clock_requests'::name),
        ('public'::name, 'audit_events'::name),
        ('public'::name, 'invitations'::name),
        ('public'::name, 'memberships'::name),
        ('public'::name, 'organizations'::name),
        ('public'::name, 'profiles'::name),
        ('public'::name, 'worksites'::name)
      union
      select namespace.nspname, class.relname
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as class on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where attribute.attname = 'organization_id' and attribute.attnum > 0
        and not attribute.attisdropped and class.relkind in ('r', 'p')
        and namespace.nspname in ('public', 'private')
      union
      select namespace.nspname, class.relname
      from pg_catalog.pg_constraint as constraint_record
      join pg_catalog.pg_class as class on class.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where constraint_record.contype = 'f'
        and constraint_record.confrelid = 'auth.users'::pg_catalog.regclass
        and pg_catalog.array_length(constraint_record.conkey, 1) = 1
        and namespace.nspname in ('public', 'private')
    ) as candidate(schema_name, relation_name)
    order by candidate.schema_name, candidate.relation_name
  loop
    execute pg_catalog.format(
      'lock table %I.%I in %s mode',
      relation.schema_name, relation.relation_name, relation.lock_mode
    );
  end loop;

  if not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = ${managerId}::uuid
      and pg_catalog.lower(auth_user.email) = ${managerEmail}
      and auth_user.deleted_at is null
      and auth_user.email_confirmed_at is not null
      and auth_user.created_at >= ${startedAt}::timestamptz
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture' = ${marker}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_run_id' = ${runId}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_proof' = ${proof}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_organization_id' = ${organizationId}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_role' = 'manager'
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if employee_user is not null and not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = employee_user
      and pg_catalog.lower(auth_user.email) = ${employeeEmail}
      and auth_user.deleted_at is null
      and auth_user.invited_at is not null
      and auth_user.created_at >= ${startedAt}::timestamptz
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture' = ${marker}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_run_id' = ${runId}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_proof' = ${proof}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_organization_id' = ${organizationId}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_role' = 'employee'
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (select 1 from public.organizations where id = ${organizationId}::uuid)
    and not exists (
      select 1 from public.organizations
      where id = ${organizationId}::uuid
        and name = ${organizationName}
        and lifecycle_status = 'research_pilot'
        and created_at >= ${startedAt}::timestamptz
    ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.worksites
    where organization_id = ${organizationId}::uuid
      and (id = ${worksiteId}::uuid and name = ${worksiteName}
        and timezone = 'Europe/Brussels'
        and created_at >= ${startedAt}::timestamptz) is not true
  ) or (select pg_catalog.count(*) from public.worksites
        where organization_id = ${organizationId}::uuid) > 1 then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.memberships as membership
    where membership.organization_id = ${organizationId}::uuid and (
      (membership.id = ${membershipId}::uuid
        and membership.user_id = ${managerId}::uuid
        and membership.role = 'manager' and membership.status = 'active'
        and membership.employee_code is null
        and membership.created_at >= ${startedAt}::timestamptz)
      or (employee_user is not null and membership.user_id = employee_user
        and membership.role = 'employee' and membership.status = 'active'
        and membership.employee_code = ${employeeCode}
        and membership.created_at >= ${startedAt}::timestamptz)
    ) is not true
  ) or (select pg_catalog.count(*) from public.memberships
        where organization_id = ${organizationId}::uuid
          and id = ${membershipId}::uuid) > 1
    or (employee_user is not null and (
      select pg_catalog.count(*) from public.memberships
      where organization_id = ${organizationId}::uuid and user_id = employee_user
    ) > 1)
    or exists (
      select 1 from public.memberships
      where user_id = any(fixture_users) and organization_id <> ${organizationId}::uuid
    ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if employee_user is not null then
    select membership.id into employee_membership
    from public.memberships as membership
    where membership.organization_id = ${organizationId}::uuid
      and membership.user_id = employee_user
      and membership.role = 'employee' and membership.status = 'active'
      and membership.employee_code = ${employeeCode};
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.user_id = ${managerId}::uuid and (
      profile.display_name = 'Fictieve lokale E2E-beheerder'
      and profile.locale = 'nl-BE'
      and profile.created_at >= ${startedAt}::timestamptz) is not true
  ) or (employee_user is not null and exists (
    select 1 from public.profiles as profile
    where profile.user_id = employee_user and (
      profile.display_name = ${employeeName} and profile.locale = 'nl-BE'
      and profile.created_at >= ${startedAt}::timestamptz) is not true
  )) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.invitations as invitation
    where invitation.organization_id = ${organizationId}::uuid and (
      employee_user is not null
      and invitation.id = ${invitationId}::uuid
      and invitation.normalized_email = ${employeeEmail}
      and invitation.invited_by = ${managerId}::uuid
      and invitation.intended_role = 'employee'
      and invitation.display_name = ${employeeName}
      and invitation.employee_code = ${employeeCode}
      and invitation.created_at >= ${startedAt}::timestamptz
      and (
        (invitation.status = 'pending' and invitation.accepted_by is null)
        or (invitation.status = 'accepted' and invitation.accepted_by = employee_user)
      )
    ) is not true
  ) or (select pg_catalog.count(*) from public.invitations
        where organization_id = ${organizationId}::uuid) > 1
    or exists (
      select 1 from public.invitations
      where organization_id <> ${organizationId}::uuid
        and (invited_by = any(fixture_users) or accepted_by = any(fixture_users))
    ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from auth.mfa_factors as factor
    where factor.user_id = any(fixture_users) and (
      factor.user_id = ${managerId}::uuid and factor.factor_type = 'totp'
      and factor.status = 'verified'
      and factor.created_at >= ${startedAt}::timestamptz
    ) is not true
  ) or (select pg_catalog.count(*) from auth.mfa_factors
        where user_id = ${managerId}::uuid) > 1
    or exists (
      select 1 from private.manager_mfa_registrations as registration
      where (registration.auth_user_id = any(fixture_users)
        or registration.provider_factor_id in (
          select factor.id from auth.mfa_factors as factor
          where factor.user_id = any(fixture_users)
        )) and (
          registration.auth_user_id = ${managerId}::uuid
          and registration.registered_at >= ${startedAt}::timestamptz
          and exists (
            select 1 from auth.mfa_factors as factor
            where factor.id = registration.provider_factor_id
              and factor.user_id = ${managerId}::uuid
              and factor.factor_type = 'totp' and factor.status = 'verified'
          )
        ) is not true
    ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.time_entries as entry
    where (
      entry.organization_id = ${organizationId}::uuid
      or entry.membership_id = ${membershipId}::uuid
      or (employee_membership is not null and entry.membership_id = employee_membership)
      or entry.worksite_id = ${worksiteId}::uuid
    ) and (
      employee_membership is not null
      and entry.organization_id = ${organizationId}::uuid
      and entry.membership_id = employee_membership
      and entry.worksite_id = ${worksiteId}::uuid
      and entry.origin = 'clock'
      and entry.last_correction_request_id is null
      and entry.created_at >= ${startedAt}::timestamptz
    ) is not true
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.time_breaks as break_record
    where (
      break_record.organization_id = ${organizationId}::uuid
      or break_record.employee_membership_id = ${membershipId}::uuid
      or (employee_membership is not null
        and break_record.employee_membership_id = employee_membership)
      or break_record.worksite_id = ${worksiteId}::uuid
      or exists (
        select 1 from public.time_entries as entry
        where entry.id = break_record.time_entry_id
          and entry.organization_id = ${organizationId}::uuid
      )
    ) and (
      employee_membership is not null
      and break_record.organization_id = ${organizationId}::uuid
      and break_record.employee_membership_id = employee_membership
      and break_record.worksite_id = ${worksiteId}::uuid
      and break_record.origin = 'live'
      and break_record.created_at >= ${startedAt}::timestamptz
      and exists (
        select 1 from public.time_entries as entry
        where entry.id = break_record.time_entry_id
          and entry.organization_id = ${organizationId}::uuid
          and entry.membership_id = employee_membership
          and entry.worksite_id = ${worksiteId}::uuid
          and entry.origin = 'clock'
          and entry.last_correction_request_id is null
      )
    ) is not true
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from private.time_clock_requests as request
    where (
      request.membership_id = ${membershipId}::uuid
      or (employee_membership is not null and request.membership_id = employee_membership)
      or request.worksite_id = ${worksiteId}::uuid
      or exists (
        select 1 from public.time_entries as entry
        where entry.id = request.time_entry_id
          and entry.organization_id = ${organizationId}::uuid
      )
    ) and (
      employee_membership is not null
      and request.membership_id = employee_membership
      and request.worksite_id = ${worksiteId}::uuid
      and request.processed_at >= ${startedAt}::timestamptz
      and (
        (request.time_entry_id is null and request.operation = 'clock_out'
          and request.result_code = 'already_stopped'
          and request.started_at is null and request.ended_at is null)
        or exists (
          select 1 from public.time_entries as entry
          where entry.id = request.time_entry_id
            and entry.organization_id = ${organizationId}::uuid
            and entry.membership_id = employee_membership
            and entry.worksite_id = ${worksiteId}::uuid
            and entry.origin = 'clock'
            and entry.last_correction_request_id is null
        )
      )
    ) is not true
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from private.time_break_operations as operation_record
    where (
      operation_record.organization_id = ${organizationId}::uuid
      or operation_record.employee_membership_id = ${membershipId}::uuid
      or (employee_membership is not null
        and operation_record.employee_membership_id = employee_membership)
      or exists (
        select 1 from public.time_entries as entry
        where entry.id::text = operation_record.result ->> 'time_entry_id'
          and entry.organization_id = ${organizationId}::uuid
      )
      or exists (
        select 1 from public.time_breaks as break_record
        where break_record.id::text = operation_record.result ->> 'break_id'
          and break_record.organization_id = ${organizationId}::uuid
      )
    ) and (
      employee_membership is not null
      and operation_record.organization_id = ${organizationId}::uuid
      and operation_record.employee_membership_id = employee_membership
      and operation_record.processed_at >= ${startedAt}::timestamptz
      and operation_record.result ->> 'request_id' = operation_record.request_id::text
      and (
        operation_record.result ->> 'time_entry_id' is null
        or exists (
          select 1 from public.time_entries as entry
          where entry.id::text = operation_record.result ->> 'time_entry_id'
            and entry.organization_id = ${organizationId}::uuid
            and entry.membership_id = employee_membership
            and entry.worksite_id = ${worksiteId}::uuid
            and entry.origin = 'clock'
            and entry.last_correction_request_id is null
        )
      )
      and (
        operation_record.result ->> 'break_id' is null
        or exists (
          select 1 from public.time_breaks as break_record
          where break_record.id::text = operation_record.result ->> 'break_id'
            and break_record.organization_id = ${organizationId}::uuid
            and break_record.employee_membership_id = employee_membership
            and break_record.worksite_id = ${worksiteId}::uuid
        )
      )
    ) is not true
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  if exists (
    select 1 from public.audit_events as audit_event
    where (audit_event.organization_id = ${organizationId}::uuid
      or audit_event.actor_user_id = any(fixture_users)) and (
        audit_event.organization_id = ${organizationId}::uuid
        and audit_event.actor_user_id = any(fixture_users)
        and audit_event.created_at >= ${startedAt}::timestamptz
      ) is not true
  ) then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;

  for relation in
    select namespace.nspname as schema_name, class.relname as relation_name
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as class on class.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where attribute.attname = 'organization_id' and attribute.attnum > 0
      and not attribute.attisdropped and class.relkind in ('r', 'p')
      and namespace.nspname in ('public', 'private')
      and not (
        (namespace.nspname = 'public' and class.relname in (
          'worksites', 'memberships', 'invitations', 'audit_events',
          'time_entries', 'time_breaks'
        ))
        or (namespace.nspname = 'private'
          and class.relname = 'time_break_operations')
      )
    order by namespace.nspname, class.relname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I where organization_id = $1)',
      relation.schema_name, relation.relation_name
    ) into has_rows using ${organizationId}::uuid;
    if has_rows then
      raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
    end if;
  end loop;

  for relation in
    select namespace.nspname as schema_name, class.relname as relation_name,
      attribute.attname as column_name
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = class.oid and attribute.attnum = constraint_record.conkey[1]
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'auth.users'::pg_catalog.regclass
      and pg_catalog.array_length(constraint_record.conkey, 1) = 1
      and namespace.nspname in ('public', 'private')
      and not (
        (namespace.nspname = 'public' and class.relname = 'profiles' and attribute.attname = 'user_id')
        or (namespace.nspname = 'public' and class.relname = 'memberships' and attribute.attname = 'user_id')
        or (namespace.nspname = 'public' and class.relname = 'invitations'
          and attribute.attname in ('invited_by', 'accepted_by'))
        or (namespace.nspname = 'public' and class.relname = 'audit_events'
          and attribute.attname = 'actor_user_id')
        or (namespace.nspname = 'private' and class.relname = 'manager_mfa_registrations'
          and attribute.attname = 'auth_user_id')
      )
    order by namespace.nspname, class.relname, attribute.attname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I where %I = any($1))',
      relation.schema_name, relation.relation_name, relation.column_name
    ) into has_rows using fixture_users;
    if has_rows then
      raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
    end if;
  end loop;

  select pg_catalog.count(*) = 5 into triggers_ready
  from (
    values
      ('private.time_break_operations'::pg_catalog.regclass, 'time_break_operation_immutable'::name),
      ('private.time_clock_requests'::pg_catalog.regclass, 'time_clock_operation_immutable'::name),
      ('public.audit_events'::pg_catalog.regclass, 'audit_events_reject_mutation'::name),
      ('public.time_breaks'::pg_catalog.regclass, 'time_break_history'::name),
      ('public.time_entries'::pg_catalog.regclass, 'time_entry_history'::name)
  ) as expected(relation_id, trigger_name)
  join pg_catalog.pg_trigger as trigger
    on trigger.tgrelid = expected.relation_id and trigger.tgname = expected.trigger_name
  where not trigger.tgisinternal and trigger.tgenabled = 'O';
  if not triggers_ready then
    raise exception using errcode = '42501', message = 'local_auth_fixture_ownership_unverified';
  end if;
end;
$cloxa_local_auth_fixture$;
alter table private.time_break_operations disable trigger time_break_operation_immutable;
alter table private.time_clock_requests disable trigger time_clock_operation_immutable;
alter table public.time_breaks disable trigger time_break_history;
alter table public.audit_events disable trigger audit_events_reject_mutation;
alter table public.time_entries disable trigger time_entry_history;
delete from private.time_break_operations
where organization_id = ${organizationId}::uuid
  and employee_membership_id in (
    select id from public.memberships
    where organization_id = ${organizationId}::uuid and user_id = ${employeeId}::uuid
  );
delete from private.time_clock_requests
where membership_id in (
    select id from public.memberships
    where organization_id = ${organizationId}::uuid and user_id = ${employeeId}::uuid
  ) and worksite_id = ${worksiteId}::uuid
  and (time_entry_id is null or exists (
    select 1 from public.time_entries as entry
    where entry.id = private.time_clock_requests.time_entry_id
      and entry.organization_id = ${organizationId}::uuid
      and entry.membership_id = private.time_clock_requests.membership_id
      and entry.worksite_id = ${worksiteId}::uuid
  ));
delete from public.time_breaks
where organization_id = ${organizationId}::uuid
  and employee_membership_id in (
    select id from public.memberships
    where organization_id = ${organizationId}::uuid and user_id = ${employeeId}::uuid
  ) and worksite_id = ${worksiteId}::uuid
  and exists (
    select 1 from public.time_entries as entry
    where entry.id = public.time_breaks.time_entry_id
      and entry.organization_id = ${organizationId}::uuid
      and entry.membership_id = public.time_breaks.employee_membership_id
      and entry.worksite_id = ${worksiteId}::uuid
  );
delete from public.audit_events where organization_id = ${organizationId}::uuid;
delete from public.invitations
where id = ${invitationId}::uuid and organization_id = ${organizationId}::uuid;
delete from public.time_entries
where organization_id = ${organizationId}::uuid
  and membership_id in (
    select id from public.memberships
    where organization_id = ${organizationId}::uuid and user_id = ${employeeId}::uuid
  ) and worksite_id = ${worksiteId}::uuid
  and origin = 'clock' and last_correction_request_id is null;
delete from public.memberships
where organization_id = ${organizationId}::uuid
  and (id = ${membershipId}::uuid or user_id = ${employeeId}::uuid);
delete from public.worksites
where id = ${worksiteId}::uuid and organization_id = ${organizationId}::uuid;
delete from public.profiles where user_id = any(${users});
delete from private.manager_mfa_registrations
where auth_user_id = ${managerId}::uuid;
delete from public.organizations where id = ${organizationId}::uuid;
alter table public.time_entries enable trigger time_entry_history;
alter table public.audit_events enable trigger audit_events_reject_mutation;
alter table public.time_breaks enable trigger time_break_history;
alter table private.time_clock_requests enable trigger time_clock_operation_immutable;
alter table private.time_break_operations enable trigger time_break_operation_immutable;
do $cloxa_local_auth_fixture_postconditions$
declare
  fixture_users uuid[] := ${users};
  has_rows boolean;
  relation record;
  triggers_ready boolean;
begin
  select pg_catalog.count(*) = 5 into triggers_ready
  from (
    values
      ('private.time_break_operations'::pg_catalog.regclass, 'time_break_operation_immutable'::name),
      ('private.time_clock_requests'::pg_catalog.regclass, 'time_clock_operation_immutable'::name),
      ('public.audit_events'::pg_catalog.regclass, 'audit_events_reject_mutation'::name),
      ('public.time_breaks'::pg_catalog.regclass, 'time_break_history'::name),
      ('public.time_entries'::pg_catalog.regclass, 'time_entry_history'::name)
  ) as expected(relation_id, trigger_name)
  join pg_catalog.pg_trigger as trigger
    on trigger.tgrelid = expected.relation_id and trigger.tgname = expected.trigger_name
  where not trigger.tgisinternal and trigger.tgenabled = 'O';
  if not triggers_ready then
    raise exception using errcode = '55000', message = 'local_auth_fixture_cleanup_incomplete';
  end if;

  if exists (select 1 from public.organizations where id = ${organizationId}::uuid)
    or exists (select 1 from public.profiles where user_id = any(fixture_users))
    or exists (select 1 from private.manager_mfa_registrations
      where auth_user_id = any(fixture_users))
    or exists (select 1 from private.time_clock_requests
      where worksite_id = ${worksiteId}::uuid
        or membership_id = ${membershipId}::uuid) then
    raise exception using errcode = '55000', message = 'local_auth_fixture_cleanup_incomplete';
  end if;

  for relation in
    select namespace.nspname as schema_name, class.relname as relation_name
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as class on class.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where attribute.attname = 'organization_id' and attribute.attnum > 0
      and not attribute.attisdropped and class.relkind in ('r', 'p')
      and namespace.nspname in ('public', 'private')
    order by namespace.nspname, class.relname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I where organization_id = $1)',
      relation.schema_name, relation.relation_name
    ) into has_rows using ${organizationId}::uuid;
    if has_rows then
      raise exception using errcode = '55000', message = 'local_auth_fixture_cleanup_incomplete';
    end if;
  end loop;

  for relation in
    select namespace.nspname as schema_name, class.relname as relation_name,
      attribute.attname as column_name
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as class on class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = class.oid and attribute.attnum = constraint_record.conkey[1]
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'auth.users'::pg_catalog.regclass
      and pg_catalog.array_length(constraint_record.conkey, 1) = 1
      and namespace.nspname in ('public', 'private')
    order by namespace.nspname, class.relname, attribute.attname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I where %I = any($1))',
      relation.schema_name, relation.relation_name, relation.column_name
    ) into has_rows using fixture_users;
    if has_rows then
      raise exception using errcode = '55000', message = 'local_auth_fixture_cleanup_incomplete';
    end if;
  end loop;
end;
$cloxa_local_auth_fixture_postconditions$;
select pg_catalog.json_build_object('status', 'database_cleaned');
commit;`;
}

export function createLocalAuthFixtureDatabase({
  dockerEndpoint,
  dockerEnvironment,
  runSql = runOperatorSql,
  timeoutMs,
}) {
  return {
    cleanup(lease, { signal } = {}) {
      return runSql(buildLocalAuthCleanupSql(lease), {
        dockerEndpoint,
        environment: dockerEnvironment,
        ...(signal === undefined ? {} : { signal }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
  };
}

function remainingResources(lease) {
  const remaining = [];
  if (lease.cleanup.database !== "cleaned") remaining.push("application_data");
  if (lease.employee.state === "owned") remaining.push("employee_auth");
  if (lease.manager.state === "owned") remaining.push("manager_auth");
  if (lease.employee.state === "uncertain") remaining.push("unverified_employee");
  if (lease.manager.state === "uncertain") remaining.push("unverified_manager");
  if (
    [
      lease.organization,
      lease.worksite,
      lease.managerProfile,
      lease.managerMembership,
    ].some((resource) => resource.state === "uncertain")
  ) {
    remaining.push("unverified_application_data");
  }
  return [...new Set(remaining)];
}

function cleanupReport(lease, status) {
  return { remaining: remainingResources(lease), status };
}

function cleanupOwnershipIsKnown(lease) {
  return (
    lease.manager.state === "owned" &&
    ![
      lease.organization,
      lease.worksite,
      lease.managerProfile,
      lease.managerMembership,
    ].some((resource) => resource.state === "uncertain") &&
    (!lease.employee.invitationAttempted || lease.employee.state === "owned")
  );
}

export async function cleanupLocalAuthE2eLease(lease, { database, signal, store }) {
  try {
    assertLease(lease);
  } catch {
    return { remaining: ["unverified_fixture"], status: "preserved" };
  }

  if (
    lease.manager.state === "planned" &&
    lease.organization.state === "planned" &&
    lease.worksite.state === "planned" &&
    lease.managerProfile.state === "planned" &&
    lease.managerMembership.state === "planned" &&
    !lease.employee.invitationAttempted
  ) {
    lease.cleanup.database = "cleaned";
    return cleanupReport(lease, "cleaned");
  }

  if (!cleanupOwnershipIsKnown(lease)) {
    return cleanupReport(lease, "preserved");
  }

  const operationSignal = leaseSignal(lease, signal);

  try {
    throwIfAborted(operationSignal);
    if (lease.manager.state === "owned") {
      const manager = await store.getUser(lease.manager.userId);
      throwIfAborted(operationSignal);
      assertFixtureUserOwnership(manager, lease, "manager", lease.manager.userId);
    }
    if (lease.employee.state === "owned") {
      const employee = await store.getUser(lease.employee.userId);
      throwIfAborted(operationSignal);
      assertFixtureUserOwnership(employee, lease, "employee", lease.employee.userId);
    }
  } catch {
    return cleanupReport(lease, "preserved");
  }

  if (lease.cleanup.database !== "cleaned") {
    try {
      throwIfAborted(operationSignal);
      const result = await database.cleanup(lease, { signal: operationSignal });
      throwIfAborted(operationSignal);
      if (result?.status !== "database_cleaned") {
        return cleanupReport(lease, "preserved");
      }
      lease.cleanup.database = "cleaned";
    } catch {
      return cleanupReport(lease, "preserved");
    }
  }

  for (const role of ["employee", "manager"]) {
    const resource = lease[role];
    if (resource.state !== "owned") continue;
    try {
      throwIfAborted(operationSignal);
      const user = await store.getUser(resource.userId);
      throwIfAborted(operationSignal);
      assertFixtureUserOwnership(user, lease, role, resource.userId);
      throwIfAborted(operationSignal);
      resource.state = "uncertain";
      await store.deleteUser(resource.userId);
      throwIfAborted(operationSignal);
      resource.state = "deleted";
    } catch {
      return cleanupReport(lease, "partial");
    }
  }

  return cleanupReport(lease, "cleaned");
}
