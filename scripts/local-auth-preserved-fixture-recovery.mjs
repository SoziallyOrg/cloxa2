import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  assertFixtureUserOwnership,
  buildLocalAuthCleanupSql,
  cleanupLocalAuthE2eLease,
  createLocalAuthFixtureFetch,
  createSupabaseFixtureStore,
  localAuthE2eFixtureMarker,
  localAuthFixtureDeadlines,
} from "./local-auth-e2e-fixture.mjs";
import {
  loadLocalEnvironment,
  LocalAuthError,
  localOnlyFetch,
  projectRoot,
} from "./local-auth-config.mjs";
import {
  runOperatorSqlAsync,
  validateLocalOperatorEnvironment,
} from "./local-manager-mfa-recovery.mjs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/iu;
const identifierPattern = /^[a-z_][a-z0-9_]*$/u;
const recoverySchema = "cloxa.preserved-ux-fixture-recovery";
const recoveryVersion = 1;
const snapshotSchema = "cloxa.preserved-ux-fixture-snapshot";
const snapshotVersion = 1;
const forbiddenEvidenceWords = new Set([
  "cookie",
  "otp",
  "password",
  "secret",
  "session",
  "token",
]);

const runId = "a3a76fea-4c19-45cd-9fa4-750432f20d94";
const organizationId = "6ba3fda2-97f5-4b0b-86a3-4e3f372fd164";
const managerUserId = "e5a5b363-c46a-4bf9-b43c-5165a4776124";
const employeeUserId = "a449e191-5d60-47d2-bde9-03dadd04bc49";
const managerMembershipId = "c398e806-bf6b-4ed6-98ee-534e0a644cef";
const employeeMembershipId = "4514106d-92f3-4b2c-9b23-4a961780f4d1";
const worksiteId = "17d63273-abd8-407a-80d7-8a3cf6f6a62f";
const invitationId = "ba21156e-43c2-4c41-8a7e-8ec31e417be3";
const timeEntryId = "0ff0cf20-c3c2-42f2-a837-8d993240fd0c";
const factorId = "124dd369-dba3-479c-a657-1dd12e5beb7c";

function frozen(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

export const preservedUxFixtureRecoveryDescriptor = frozen({
  auditEventIds: [
    "2331ff52-c8c1-4110-9d36-9230af79039c",
    "48c052d6-eb31-4b57-b025-f5ff01359d9d",
    "586cd805-6a43-4311-a44a-f75ae5b3dfa3",
    "5fb2ca5b-4746-4642-944d-028aaac68200",
    "8bd82167-79e9-495a-b879-9b690233ad99",
    "a5ac0f55-b5d7-4120-b340-7d8d8f686cdc",
    "d98268b4-02be-46f7-817b-bd600eae1201",
    "e3449eae-d7a9-4ad1-b245-739cc70de811",
    "e9df52f3-f2aa-4bb3-a936-41088b993619",
  ],
  breakOperationIds: [
    "2533b568-7b3f-42ed-90fb-a7e8b8fab92f",
    "2a2b5185-582c-4c62-a247-6b0320caa11c",
    "572e2e98-5bf8-4635-bc6b-569f39396404",
    "65158192-cc5c-4545-b41f-e08331ec844a",
  ],
  breakIds: [
    "550538c4-ae91-4811-822f-79c4cfa70def",
    "83a08b1b-f1a6-41dc-b573-95baf8c9ddef",
  ],
  cardinalities: {
    auditEvents: 9,
    breakCorrectionRequests: 0,
    breakOperations: 4,
    breakRevisions: 0,
    breaks: 2,
    clockRequests: 2,
    entryCorrectionRequests: 0,
    invitations: 1,
    managerMfaRegistrations: 1,
    managerVerifiedTotpFactors: 1,
    memberships: 2,
    organizations: 1,
    profiles: 2,
    timeEntries: 1,
    unsupportedAuthReferences: 0,
    unsupportedOrganizationReferences: 0,
    worksites: 1,
  },
  clockRequestIds: [
    "316bdee9-5f86-41a9-a04c-d3fbbc7c6e6f",
    "9c35fd07-dd87-4b23-bf02-e2c796437a57",
  ],
  employee: {
    code: `E2E-${runId.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
    displayName: "Fictieve medewerker",
    email: `local-auth.employee.${runId}@example.test`,
    membershipId: employeeMembershipId,
    userId: employeeUserId,
  },
  factorId,
  invitationId,
  manager: {
    displayName: "Fictieve lokale E2E-beheerder",
    email: `local-auth.manager.${runId}@example.test`,
    membershipId: managerMembershipId,
    userId: managerUserId,
  },
  marker: localAuthE2eFixtureMarker,
  organization: {
    id: organizationId,
    lifecycleStatus: "research_pilot",
    name: `Local Auth E2E ${runId}`,
  },
  preservationSha256:
    "88f34aaed7ab9fc190dc5ec781d250ffc4b25487e2b472ba1b4c1af622592947",
  references: {
    authUsers: {
      "private.manager_mfa_recovery_candidates.auth_user_id": 0,
      "private.manager_mfa_recovery_cases.auth_user_id": 0,
      "public.audit_events.actor_user_id": 9,
      "public.invitations.accepted_by": 1,
      "public.invitations.invited_by": 1,
      "public.memberships.user_id": 2,
      "public.profiles.user_id": 2,
    },
    organizations: {
      "private.break_correction_decision_operations": 0,
      "private.break_correction_request_operations": 0,
      "private.correction_request_operations": 0,
      "private.manager_decision_operations": 0,
      "private.manager_mfa_recovery_cases": 0,
      "private.manager_team_operations": 0,
      "private.time_break_operations": 4,
      "private.time_export_creation_operations": 0,
      "private.time_export_rows": 0,
      "private.time_export_v2_operations": 0,
      "private.time_export_v2_snapshots": 0,
      "public.audit_events": 9,
      "public.break_correction_requests": 0,
      "public.correction_requests": 0,
      "public.invitations": 1,
      "public.memberships": 2,
      "public.time_break_revisions": 0,
      "public.time_breaks": 2,
      "public.time_entries": 1,
      "public.time_exports": 0,
      "public.time_exports_v2": 0,
      "public.worksites": 1,
    },
  },
  runId,
  timeEntryId,
  worksite: {
    id: worksiteId,
    name: `Local Auth E2E ${runId}`,
    timezone: "Europe/Brussels",
  },
});

const descriptor = preservedUxFixtureRecoveryDescriptor;

function recoveryError() {
  return new LocalAuthError(
    "Preserved fixture recovery proof failed. No mutation was attempted.",
  );
}

function stoppedError() {
  return new LocalAuthError(
    "Preserved fixture recovery stopped with remaining resources preserved.",
  );
}

function requireUuid(value) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw recoveryError();
  return value.toLowerCase();
}

function requireSha256(value) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw recoveryError();
  }
  return value.toLowerCase();
}

function parseFlags(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (typeof flag !== "string" || !flag.startsWith("--") || parsed.has(flag)) {
      throw recoveryError();
    }
    if (flag === "--confirm-local-development") {
      parsed.set(flag, true);
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw recoveryError();
    parsed.set(flag, value);
    index += 1;
  }
  return parsed;
}

export function parsePreservedFixtureRecoveryArguments(args) {
  const flags = parseFlags(args);
  const expected = [
    "--confirm-local-development",
    "--confirm-run",
    "--confirm-organization",
    "--confirm-manager-user",
    "--confirm-employee-user",
    "--confirm-preservation-sha256",
  ];
  if (
    flags.size !== expected.length ||
    expected.some((flag) => !flags.has(flag)) ||
    flags.get("--confirm-local-development") !== true
  ) {
    throw recoveryError();
  }
  const parsed = {
    employeeUserId: requireUuid(flags.get("--confirm-employee-user")),
    managerUserId: requireUuid(flags.get("--confirm-manager-user")),
    organizationId: requireUuid(flags.get("--confirm-organization")),
    preservationSha256: requireSha256(flags.get("--confirm-preservation-sha256")),
    runId: requireUuid(flags.get("--confirm-run")),
  };
  if (
    parsed.runId !== preservedUxFixtureRecoveryDescriptor.runId ||
    parsed.organizationId !== preservedUxFixtureRecoveryDescriptor.organization.id ||
    parsed.managerUserId !== preservedUxFixtureRecoveryDescriptor.manager.userId ||
    parsed.employeeUserId !== preservedUxFixtureRecoveryDescriptor.employee.userId ||
    parsed.preservationSha256 !==
      preservedUxFixtureRecoveryDescriptor.preservationSha256
  ) {
    throw recoveryError();
  }
  return parsed;
}

function instant(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw recoveryError();
  }
  return new Date(value).toISOString();
}

function exactUser(user, expected, role) {
  const metadata = user?.app_metadata;
  if (
    !user ||
    user.id !== expected.userId ||
    user.email?.toLowerCase() !== expected.email ||
    user.deleted_at ||
    !user.email_confirmed_at ||
    (role === "employee" && !user.invited_at) ||
    metadata?.cloxa_local_fixture !== preservedUxFixtureRecoveryDescriptor.marker ||
    metadata?.cloxa_local_fixture_run_id !==
      preservedUxFixtureRecoveryDescriptor.runId ||
    metadata?.cloxa_local_fixture_organization_id !==
      preservedUxFixtureRecoveryDescriptor.organization.id ||
    metadata?.cloxa_local_fixture_role !== role ||
    typeof metadata?.cloxa_local_fixture_proof !== "string" ||
    !uuidPattern.test(metadata.cloxa_local_fixture_proof)
  ) {
    throw recoveryError();
  }
  instant(user.created_at);
  return user;
}

function exactFactors(managerFactors, employeeFactors) {
  if (
    !Array.isArray(managerFactors) ||
    !Array.isArray(employeeFactors) ||
    managerFactors.length !== 1 ||
    employeeFactors.length !== 0
  ) {
    throw recoveryError();
  }
  const factor = managerFactors[0];
  if (
    factor?.id !== preservedUxFixtureRecoveryDescriptor.factorId ||
    factor.factor_type !== "totp" ||
    factor.status !== "verified"
  ) {
    throw recoveryError();
  }
}

export function reconstructPreservedFixtureLease({
  employeeFactors,
  employeeUser,
  managerFactors,
  managerUser,
}) {
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  exactUser(managerUser, descriptor.manager, "manager");
  exactUser(employeeUser, descriptor.employee, "employee");
  exactFactors(managerFactors, employeeFactors);
  const managerProof = managerUser.app_metadata.cloxa_local_fixture_proof;
  const employeeProof = employeeUser.app_metadata.cloxa_local_fixture_proof;
  if (managerProof !== employeeProof) throw recoveryError();

  // Manager creation is the earliest independently diagnosed owned root. Normalize
  // its exact service value to a JavaScript ISO instant and reject any earlier child.
  const startedAt = instant(managerUser.created_at);
  for (const value of [
    managerUser.email_confirmed_at,
    employeeUser.created_at,
    employeeUser.email_confirmed_at,
    employeeUser.invited_at,
  ]) {
    requireAtOrAfter(value, startedAt);
  }
  const lease = {
    cleanup: { database: "pending" },
    employee: {
      code: descriptor.employee.code,
      displayName: descriptor.employee.displayName,
      email: descriptor.employee.email,
      emailAbsent: true,
      invitationAttempted: true,
      invitationId: descriptor.invitationId,
      state: "owned",
      userId: descriptor.employee.userId,
    },
    manager: {
      email: descriptor.manager.email,
      emailAbsent: true,
      state: "owned",
      userId: descriptor.manager.userId,
    },
    managerMembership: { id: descriptor.manager.membershipId, state: "owned" },
    managerProfile: { state: "owned" },
    marker: descriptor.marker,
    organization: {
      id: descriptor.organization.id,
      name: descriptor.organization.name,
      state: "owned",
    },
    proof: managerProof,
    runId: descriptor.runId,
    startedAt,
    worksite: {
      id: descriptor.worksite.id,
      name: descriptor.worksite.name,
      state: "owned",
    },
  };
  assertFixtureUserOwnership(managerUser, lease, "manager", descriptor.manager.userId);
  assertFixtureUserOwnership(
    employeeUser,
    lease,
    "employee",
    descriptor.employee.userId,
  );
  return lease;
}

function sqlText(value) {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value)) throw recoveryError();
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value) {
  return `${sqlText(requireUuid(value))}::uuid`;
}

function sqlIdentifier(value) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw recoveryError();
  }
  return `"${value}"`;
}

export function buildPreservedFixtureCatalogSql() {
  return `begin read only;
set local lock_timeout = '1s';
set local statement_timeout = '5s';
with organization_columns as (
  select namespace.nspname as schema_name, class.relname as table_name
  from pg_catalog.pg_attribute as attribute
  join pg_catalog.pg_class as class on class.oid = attribute.attrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
  where attribute.attname = 'organization_id' and attribute.attnum > 0
    and not attribute.attisdropped and class.relkind in ('r', 'p')
    and namespace.nspname in ('public', 'private')
), auth_user_columns as (
  select namespace.nspname as schema_name, class.relname as table_name,
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
)
select pg_catalog.jsonb_build_object(
  'schema', 'cloxa.preserved-ux-fixture-catalog',
  'version', 1,
  'organizationColumns', coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('schema', schema_name, 'table', table_name)
    order by schema_name, table_name) from organization_columns), '[]'::jsonb),
  'authUserColumns', coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('schema', schema_name, 'table', table_name,
      'column', column_name) order by schema_name, table_name, column_name)
    from auth_user_columns), '[]'::jsonb)
);
rollback;`;
}

function catalogRelation(row, includeColumn) {
  if (!row || typeof row !== "object") throw recoveryError();
  const schema = row.schema;
  const table = row.table;
  const column = row.column;
  sqlIdentifier(schema);
  sqlIdentifier(table);
  if (includeColumn) sqlIdentifier(column);
  return includeColumn ? `${schema}.${table}.${column}` : `${schema}.${table}`;
}

export function validatePreservedFixtureCatalog(catalog) {
  if (
    catalog?.schema !== "cloxa.preserved-ux-fixture-catalog" ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.organizationColumns) ||
    !Array.isArray(catalog.authUserColumns)
  ) {
    throw recoveryError();
  }
  const organizationRelations = catalog.organizationColumns.map((row) =>
    catalogRelation(row, false),
  );
  const authRelations = catalog.authUserColumns.map((row) =>
    catalogRelation(row, true),
  );
  if (
    new Set(organizationRelations).size !== organizationRelations.length ||
    new Set(authRelations).size !== authRelations.length ||
    Object.keys(preservedUxFixtureRecoveryDescriptor.references.organizations).some(
      (relation) => !organizationRelations.includes(relation),
    ) ||
    Object.keys(preservedUxFixtureRecoveryDescriptor.references.authUsers).some(
      (relation) => !authRelations.includes(relation),
    )
  ) {
    throw recoveryError();
  }
  return catalog;
}

function referenceCountSql(catalog) {
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  const users = [descriptor.manager.userId, descriptor.employee.userId]
    .map(sqlUuid)
    .join(", ");
  const organizations = catalog.organizationColumns
    .map(({ schema, table }) => {
      const relation = `${schema}.${table}`;
      return `select ${sqlText(relation)} as relation,
        pg_catalog.count(*)::integer as row_count
      from ${sqlIdentifier(schema)}.${sqlIdentifier(table)}
      where organization_id = ${sqlUuid(descriptor.organization.id)}`;
    })
    .join("\nunion all\n");
  const authUsers = catalog.authUserColumns
    .map(({ schema, table, column }) => {
      const relation = `${schema}.${table}.${column}`;
      return `select ${sqlText(relation)} as relation,
        pg_catalog.count(*)::integer as row_count
      from ${sqlIdentifier(schema)}.${sqlIdentifier(table)}
      where ${sqlIdentifier(column)} = any(array[${users}])`;
    })
    .join("\nunion all\n");
  return { authUsers, organizations };
}

function jsonRows(select, from, where, orderBy) {
  return `coalesce((select pg_catalog.jsonb_agg(row_value order by ${orderBy}) from (
    select ${select} as row_value, ${orderBy} from ${from} where ${where}
  ) as selected_rows), '[]'::jsonb)`;
}

export function buildPreservedFixtureSnapshotSql(catalog) {
  validatePreservedFixtureCatalog(catalog);
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  const references = referenceCountSql(catalog);
  const users = [descriptor.manager.userId, descriptor.employee.userId]
    .map(sqlUuid)
    .join(", ");
  const clockRequestIds = descriptor.clockRequestIds.map(sqlUuid).join(", ");
  const breakOperationIds = descriptor.breakOperationIds.map(sqlUuid).join(", ");
  const auditIds = descriptor.auditEventIds.map(sqlUuid).join(", ");
  const organization = sqlUuid(descriptor.organization.id);
  const employee = sqlUuid(descriptor.employee.userId);
  const managerMembership = sqlUuid(descriptor.manager.membershipId);
  const employeeMembership = sqlUuid(descriptor.employee.membershipId);
  const worksite = sqlUuid(descriptor.worksite.id);
  const entry = sqlUuid(descriptor.timeEntryId);
  const factor = sqlUuid(descriptor.factorId);

  return `begin read only;
set local lock_timeout = '1s';
set local statement_timeout = '5s';
with organization_reference_counts as (
  ${references.organizations}
), auth_user_reference_counts as (
  ${references.authUsers}
)
select pg_catalog.jsonb_build_object(
  'schema', ${sqlText(snapshotSchema)},
  'version', ${snapshotVersion},
  'references', pg_catalog.jsonb_build_object(
    'organizations', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'relation', relation, 'count', row_count) order by relation)
      from organization_reference_counts),
    'authUsers', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'relation', relation, 'count', row_count) order by relation)
      from auth_user_reference_counts)
  ),
  'organization', (select pg_catalog.jsonb_build_object(
    'id', id, 'name', name, 'lifecycleStatus', lifecycle_status,
    'createdAt', created_at) from public.organizations where id = ${organization}),
  'worksites', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'name', name, 'timezone', timezone, 'createdAt', created_at)",
    "public.worksites",
    `organization_id = ${organization}`,
    "id",
  )},
  'profiles', ${jsonRows(
    "pg_catalog.jsonb_build_object('userId', user_id, 'displayName', display_name, 'locale', locale, 'createdAt', created_at)",
    "public.profiles",
    `user_id = any(array[${users}])`,
    "user_id",
  )},
  'memberships', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'userId', user_id, 'role', role, 'status', status, 'employeeCode', employee_code, 'createdAt', created_at)",
    "public.memberships",
    `organization_id = ${organization} or user_id = any(array[${users}])`,
    "id",
  )},
  'invitations', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'email', normalized_email, 'role', intended_role, 'status', status, 'invitedBy', invited_by, 'acceptedBy', accepted_by, 'displayName', display_name, 'employeeCode', employee_code, 'createdAt', created_at, 'acceptedAt', accepted_at, 'expiresAt', expires_at, 'revokedAt', revoked_at)",
    "public.invitations",
    `organization_id = ${organization} or invited_by = any(array[${users}]) or accepted_by = any(array[${users}])`,
    "id",
  )},
  'timeEntries', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'membershipId', membership_id, 'worksiteId', worksite_id, 'startedAt', started_at, 'endedAt', ended_at, 'createdAt', created_at, 'version', version, 'origin', origin, 'lastCorrectionRequestId', last_correction_request_id)",
    "public.time_entries",
    `organization_id = ${organization} or membership_id in (${managerMembership}, ${employeeMembership}) or worksite_id = ${worksite}`,
    "id",
  )},
  'breaks', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'membershipId', employee_membership_id, 'worksiteId', worksite_id, 'timeEntryId', time_entry_id, 'startedAt', started_at, 'endedAt', ended_at, 'createdAt', created_at, 'version', version, 'origin', origin)",
    "public.time_breaks",
    `organization_id = ${organization} or employee_membership_id in (${managerMembership}, ${employeeMembership}) or worksite_id = ${worksite} or time_entry_id = ${entry}`,
    "id",
  )},
  'clockRequests', ${jsonRows(
    "pg_catalog.jsonb_build_object('requestId', request_id, 'membershipId', membership_id, 'operation', operation, 'resultCode', result_code, 'timeEntryId', time_entry_id, 'worksiteId', worksite_id, 'startedAt', started_at, 'endedAt', ended_at, 'processedAt', processed_at)",
    "private.time_clock_requests",
    `request_id = any(array[${clockRequestIds}]) or membership_id in (${managerMembership}, ${employeeMembership}) or worksite_id = ${worksite} or time_entry_id = ${entry}`,
    "request_id",
  )},
  'breakOperations', ${jsonRows(
    `pg_catalog.jsonb_build_object('requestId', request_id, 'organizationId', organization_id,
      'membershipId', employee_membership_id, 'operation', operation,
      'payloadMatches', payload_hash = pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(${employee}, ${employeeMembership}, operation)::text, 'UTF8')),
      'result', result, 'processedAt', processed_at)`,
    "private.time_break_operations",
    `request_id = any(array[${breakOperationIds}]) or organization_id = ${organization} or employee_membership_id in (${managerMembership}, ${employeeMembership}) or result ->> 'time_entry_id' = ${sqlText(descriptor.timeEntryId)} or result ->> 'break_id' = any(array[${descriptor.breakIds.map(sqlText).join(", ")}])`,
    "request_id",
  )},
  'auditEvents', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'organizationId', organization_id, 'actorUserId', actor_user_id, 'actorType', actor_type, 'entityType', entity_type, 'entityId', entity_id, 'action', action, 'beforeData', before_data, 'afterData', after_data, 'createdAt', created_at)",
    "public.audit_events",
    `id = any(array[${auditIds}]) or organization_id = ${organization} or actor_user_id = any(array[${users}])`,
    "id",
  )},
  'factors', ${jsonRows(
    "pg_catalog.jsonb_build_object('id', id, 'userId', user_id, 'factorType', factor_type, 'status', status, 'createdAt', created_at)",
    "auth.mfa_factors",
    `id = ${factor} or user_id = any(array[${users}])`,
    "id",
  )},
  'mfaRegistrations', ${jsonRows(
    "pg_catalog.jsonb_build_object('authUserId', auth_user_id, 'factorId', provider_factor_id, 'registeredAt', registered_at, 'generation', generation, 'sessionCutoffAt', session_cutoff_at)",
    "private.manager_mfa_registrations",
    `auth_user_id = any(array[${users}]) or provider_factor_id = ${factor}`,
    "auth_user_id",
  )},
  'entryCorrectionRequests', (select pg_catalog.count(*)::integer
    from public.correction_requests where organization_id = ${organization}
      or target_time_entry_id = ${entry}),
  'breakCorrectionRequests', (select pg_catalog.count(*)::integer
    from public.break_correction_requests where organization_id = ${organization}
      or time_entry_id = ${entry}),
  'breakRevisions', (select pg_catalog.count(*)::integer
    from public.time_break_revisions where organization_id = ${organization}
      or time_entry_id = ${entry})
);
rollback;`;
}

function sameJson(actual, expected) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameJson(value, expected[index]))
    );
  }
  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return (
      sameJson(actualKeys, expectedKeys) &&
      actualKeys.every((key) => sameJson(actual[key], expected[key]))
    );
  }
  return actual === expected;
}

function exactRecord(record, expected) {
  if (!record || typeof record !== "object") throw recoveryError();
  for (const [key, value] of Object.entries(expected)) {
    if (!sameJson(record[key], value)) throw recoveryError();
  }
  return record;
}

function exactIds(records, expectedIds, key = "id") {
  if (!Array.isArray(records) || records.length !== expectedIds.length) {
    throw recoveryError();
  }
  const actual = records.map((record) => record?.[key]).sort();
  const expected = [...expectedIds].sort();
  if (!sameJson(actual, expected)) throw recoveryError();
}

function requireAtOrAfter(value, boundary) {
  const normalized = instant(value);
  if (Date.parse(normalized) < Date.parse(boundary)) throw recoveryError();
  return normalized;
}

function exactReferenceCounts(actual, expected) {
  if (!Array.isArray(actual)) throw recoveryError();
  const seen = new Set();
  let unsupported = 0;
  for (const row of actual) {
    if (
      !row ||
      typeof row.relation !== "string" ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      seen.has(row.relation)
    ) {
      throw recoveryError();
    }
    seen.add(row.relation);
    if (Object.hasOwn(expected, row.relation)) {
      if (row.count !== expected[row.relation]) throw recoveryError();
    } else {
      unsupported += row.count;
    }
  }
  if (Object.keys(expected).some((relation) => !seen.has(relation)) || unsupported) {
    throw recoveryError();
  }
}

function validateAuditEvents(events, boundary, breaks) {
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  exactIds(events, descriptor.auditEventIds);
  for (const event of events) {
    exactRecord(event, {
      actorType: "user",
      organizationId: descriptor.organization.id,
    });
    requireAtOrAfter(event.createdAt, boundary);
  }
  const find = (predicate) => events.filter(predicate);
  const exactOne = (predicate, expected) => {
    const matches = find(predicate);
    if (matches.length !== 1) throw recoveryError();
    exactRecord(matches[0], expected);
  };
  exactOne((event) => event.action === "manager_mfa.registered", {
    actorUserId: descriptor.manager.userId,
    afterData: { factor_type: "totp", state: "registered" },
    beforeData: null,
    entityId: descriptor.manager.membershipId,
    entityType: "manager_mfa",
  });
  exactOne((event) => event.action === "employee_invitation.created", {
    actorUserId: descriptor.manager.userId,
    afterData: { role: "employee", status: "pending" },
    beforeData: null,
    entityId: descriptor.invitationId,
    entityType: "invitation",
  });
  exactOne((event) => event.action === "employee_invitation.accepted", {
    actorUserId: descriptor.employee.userId,
    afterData: {
      membership_id: descriptor.employee.membershipId,
      status: "accepted",
    },
    beforeData: null,
    entityId: descriptor.invitationId,
    entityType: "invitation",
  });
  exactOne((event) => event.action === "time_entry.clocked_in", {
    actorUserId: descriptor.employee.userId,
    afterData: { state: "working" },
    beforeData: null,
    entityId: descriptor.timeEntryId,
    entityType: "time_entry",
  });
  exactOne((event) => event.action === "time_entry.clocked_out", {
    actorUserId: descriptor.employee.userId,
    afterData: { state: "stopped" },
    beforeData: { state: "working" },
    entityId: descriptor.timeEntryId,
    entityType: "time_entry",
  });
  for (const breakRecord of breaks) {
    exactOne(
      (event) =>
        event.action === "time_break.started" && event.entityId === breakRecord.id,
      {
        actorUserId: descriptor.employee.userId,
        afterData: {
          break_id: breakRecord.id,
          ended_at: null,
          started_at: breakRecord.startedAt,
          status: "open",
          time_entry_id: descriptor.timeEntryId,
          version: 1,
        },
        beforeData: null,
        entityType: "time_break",
      },
    );
    exactOne(
      (event) =>
        event.action === "time_break.ended" && event.entityId === breakRecord.id,
      {
        actorUserId: descriptor.employee.userId,
        afterData: {
          break_id: breakRecord.id,
          ended_at: breakRecord.endedAt,
          started_at: breakRecord.startedAt,
          status: "closed",
          time_entry_id: descriptor.timeEntryId,
          version: 2,
        },
        beforeData: null,
        entityType: "time_break",
      },
    );
  }
}

export function validatePreservedFixtureSnapshot(snapshot, lease) {
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  if (snapshot?.schema !== snapshotSchema || snapshot.version !== snapshotVersion) {
    throw recoveryError();
  }
  exactReferenceCounts(
    snapshot.references?.organizations,
    descriptor.references.organizations,
  );
  exactReferenceCounts(snapshot.references?.authUsers, descriptor.references.authUsers);
  exactRecord(snapshot.organization, {
    id: descriptor.organization.id,
    lifecycleStatus: descriptor.organization.lifecycleStatus,
    name: descriptor.organization.name,
  });
  requireAtOrAfter(snapshot.organization.createdAt, lease.startedAt);

  exactIds(snapshot.worksites, [descriptor.worksite.id]);
  exactRecord(snapshot.worksites[0], {
    name: descriptor.worksite.name,
    organizationId: descriptor.organization.id,
    timezone: descriptor.worksite.timezone,
  });
  requireAtOrAfter(snapshot.worksites[0].createdAt, lease.startedAt);

  exactIds(
    snapshot.profiles,
    [descriptor.manager.userId, descriptor.employee.userId],
    "userId",
  );
  for (const [user, displayName] of [
    [descriptor.manager, descriptor.manager.displayName],
    [descriptor.employee, descriptor.employee.displayName],
  ]) {
    const profile = snapshot.profiles.find((row) => row.userId === user.userId);
    exactRecord(profile, { displayName, locale: "nl-BE", userId: user.userId });
    requireAtOrAfter(profile.createdAt, lease.startedAt);
  }

  exactIds(snapshot.memberships, [managerMembershipId, employeeMembershipId]);
  const managerMembership = snapshot.memberships.find(
    (row) => row.id === descriptor.manager.membershipId,
  );
  exactRecord(managerMembership, {
    employeeCode: null,
    organizationId: descriptor.organization.id,
    role: "manager",
    status: "active",
    userId: descriptor.manager.userId,
  });
  requireAtOrAfter(managerMembership.createdAt, lease.startedAt);
  const employeeMembership = snapshot.memberships.find(
    (row) => row.id === descriptor.employee.membershipId,
  );
  exactRecord(employeeMembership, {
    employeeCode: descriptor.employee.code,
    organizationId: descriptor.organization.id,
    role: "employee",
    status: "active",
    userId: descriptor.employee.userId,
  });
  requireAtOrAfter(employeeMembership.createdAt, lease.startedAt);

  exactIds(snapshot.invitations, [descriptor.invitationId]);
  const invitationRecord = snapshot.invitations[0];
  exactRecord(invitationRecord, {
    acceptedBy: descriptor.employee.userId,
    displayName: descriptor.employee.displayName,
    email: descriptor.employee.email,
    employeeCode: descriptor.employee.code,
    id: descriptor.invitationId,
    invitedBy: descriptor.manager.userId,
    organizationId: descriptor.organization.id,
    revokedAt: null,
    role: "employee",
    status: "accepted",
  });
  const invitationCreated = requireAtOrAfter(
    invitationRecord.createdAt,
    lease.startedAt,
  );
  const invitationAccepted = requireAtOrAfter(
    invitationRecord.acceptedAt,
    lease.startedAt,
  );
  if (
    Date.parse(invitationAccepted) < Date.parse(invitationCreated) ||
    Date.parse(instant(invitationRecord.expiresAt)) <= Date.parse(invitationAccepted)
  ) {
    throw recoveryError();
  }

  exactIds(snapshot.timeEntries, [descriptor.timeEntryId]);
  const entry = snapshot.timeEntries[0];
  exactRecord(entry, {
    id: descriptor.timeEntryId,
    lastCorrectionRequestId: null,
    membershipId: descriptor.employee.membershipId,
    organizationId: descriptor.organization.id,
    origin: "clock",
    version: 1,
    worksiteId: descriptor.worksite.id,
  });
  const entryStart = requireAtOrAfter(entry.startedAt, lease.startedAt);
  const entryCreated = requireAtOrAfter(entry.createdAt, lease.startedAt);
  const entryEnd = requireAtOrAfter(entry.endedAt, lease.startedAt);
  if (entryCreated !== entryStart || Date.parse(entryEnd) < Date.parse(entryStart)) {
    throw recoveryError();
  }

  exactIds(snapshot.breaks, descriptor.breakIds);
  const breaks = [...snapshot.breaks].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  for (const breakRecord of breaks) {
    exactRecord(breakRecord, {
      membershipId: descriptor.employee.membershipId,
      organizationId: descriptor.organization.id,
      origin: "live",
      timeEntryId: descriptor.timeEntryId,
      version: 2,
      worksiteId: descriptor.worksite.id,
    });
    const started = requireAtOrAfter(breakRecord.startedAt, lease.startedAt);
    const created = requireAtOrAfter(breakRecord.createdAt, lease.startedAt);
    const ended = requireAtOrAfter(breakRecord.endedAt, lease.startedAt);
    if (created !== started || Date.parse(ended) <= Date.parse(started)) {
      throw recoveryError();
    }
  }
  if (
    !(Date.parse(entryStart) < Date.parse(breaks[0].startedAt)) ||
    !(Date.parse(breaks[0].endedAt) <= Date.parse(breaks[1].startedAt)) ||
    !(Date.parse(breaks[1].endedAt) <= Date.parse(entryEnd))
  ) {
    throw recoveryError();
  }

  exactIds(snapshot.clockRequests, descriptor.clockRequestIds, "requestId");
  const clockIn = snapshot.clockRequests.filter((row) => row.operation === "clock_in");
  const clockOut = snapshot.clockRequests.filter(
    (row) => row.operation === "clock_out",
  );
  if (clockIn.length !== 1 || clockOut.length !== 1) throw recoveryError();
  exactRecord(clockIn[0], {
    endedAt: null,
    membershipId: descriptor.employee.membershipId,
    resultCode: "started",
    startedAt: entry.startedAt,
    timeEntryId: descriptor.timeEntryId,
    worksiteId: descriptor.worksite.id,
  });
  exactRecord(clockOut[0], {
    endedAt: entry.endedAt,
    membershipId: descriptor.employee.membershipId,
    resultCode: "stopped",
    startedAt: entry.startedAt,
    timeEntryId: descriptor.timeEntryId,
    worksiteId: descriptor.worksite.id,
  });
  if (
    instant(clockIn[0].processedAt) !== entryStart ||
    instant(clockOut[0].processedAt) !== entryEnd
  ) {
    throw recoveryError();
  }

  exactIds(snapshot.breakOperations, descriptor.breakOperationIds, "requestId");
  for (const breakRecord of breaks) {
    for (const operation of ["start_break", "end_break"]) {
      const matches = snapshot.breakOperations.filter(
        (row) => row.operation === operation && row.result?.break_id === breakRecord.id,
      );
      if (matches.length !== 1) throw recoveryError();
      const row = matches[0];
      const ending = operation === "end_break";
      exactRecord(row, {
        membershipId: descriptor.employee.membershipId,
        organizationId: descriptor.organization.id,
        payloadMatches: true,
      });
      exactRecord(row.result, {
        break_id: breakRecord.id,
        did_transition: true,
        ended_at: ending ? breakRecord.endedAt : null,
        request_id: row.requestId,
        result_code: ending ? "ended" : "started",
        started_at: breakRecord.startedAt,
        time_entry_id: descriptor.timeEntryId,
        version: ending ? 2 : 1,
      });
      if (
        instant(row.processedAt) !==
        instant(ending ? breakRecord.endedAt : breakRecord.startedAt)
      ) {
        throw recoveryError();
      }
    }
  }

  validateAuditEvents(snapshot.auditEvents, lease.startedAt, breaks);
  exactIds(snapshot.factors, [descriptor.factorId]);
  exactRecord(snapshot.factors[0], {
    factorType: "totp",
    status: "verified",
    userId: descriptor.manager.userId,
  });
  requireAtOrAfter(snapshot.factors[0].createdAt, lease.startedAt);
  exactIds(snapshot.mfaRegistrations, [descriptor.manager.userId], "authUserId");
  exactRecord(snapshot.mfaRegistrations[0], {
    factorId: descriptor.factorId,
    generation: 1,
    sessionCutoffAt: null,
  });
  requireAtOrAfter(snapshot.mfaRegistrations[0].registeredAt, lease.startedAt);
  if (
    snapshot.entryCorrectionRequests !== 0 ||
    snapshot.breakCorrectionRequests !== 0 ||
    snapshot.breakRevisions !== 0
  ) {
    throw recoveryError();
  }
  return snapshot;
}

function exactIdArraySql(ids) {
  return `array[${ids.map(sqlUuid).join(", ")}]`;
}

function buildLockedExactGuard(lease) {
  const descriptor = preservedUxFixtureRecoveryDescriptor;
  const organization = sqlUuid(descriptor.organization.id);
  const worksite = sqlUuid(descriptor.worksite.id);
  const manager = sqlUuid(descriptor.manager.userId);
  const employee = sqlUuid(descriptor.employee.userId);
  const managerMembership = sqlUuid(descriptor.manager.membershipId);
  const employeeMembership = sqlUuid(descriptor.employee.membershipId);
  const invitation = sqlUuid(descriptor.invitationId);
  const entry = sqlUuid(descriptor.timeEntryId);
  const factor = sqlUuid(descriptor.factorId);
  const breaks = exactIdArraySql(descriptor.breakIds);
  const clockRequests = exactIdArraySql(descriptor.clockRequestIds);
  const breakOperations = exactIdArraySql(descriptor.breakOperationIds);
  const audits = exactIdArraySql(descriptor.auditEventIds);
  const boundary = `${sqlText(lease.startedAt)}::timestamptz`;
  return `  -- One-time preserved UX fixture: exact graph proof under generic cleanup locks.
  if (select pg_catalog.count(*) <> 1 from public.organizations
      where id = ${organization} and name = ${sqlText(descriptor.organization.name)}
        and lifecycle_status = 'research_pilot' and created_at >= ${boundary})
    or (select pg_catalog.count(*) <> 1 from public.worksites
      where id = ${worksite} and organization_id = ${organization}
        and name = ${sqlText(descriptor.worksite.name)} and timezone = 'Europe/Brussels'
        and created_at >= ${boundary})
    or (select pg_catalog.count(*) <> 2 from public.profiles
      where (user_id = ${manager} and display_name = ${sqlText(descriptor.manager.displayName)}
          and locale = 'nl-BE' and created_at >= ${boundary})
        or (user_id = ${employee} and display_name = ${sqlText(descriptor.employee.displayName)}
          and locale = 'nl-BE' and created_at >= ${boundary}))
    or (select pg_catalog.count(*) <> 2 from public.memberships
      where organization_id = ${organization} and (
        (id = ${managerMembership} and user_id = ${manager} and role = 'manager'
          and status = 'active' and employee_code is null and created_at >= ${boundary})
        or (id = ${employeeMembership} and user_id = ${employee} and role = 'employee'
          and status = 'active' and employee_code = ${sqlText(descriptor.employee.code)}
          and created_at >= ${boundary})))
    or (select pg_catalog.count(*) <> 1 from public.invitations
      where id = ${invitation} and organization_id = ${organization}
        and normalized_email = ${sqlText(descriptor.employee.email)}
        and intended_role = 'employee' and status = 'accepted'
        and invited_by = ${manager} and accepted_by = ${employee}
        and display_name = ${sqlText(descriptor.employee.displayName)}
        and employee_code = ${sqlText(descriptor.employee.code)} and revoked_at is null
        and created_at >= ${boundary} and accepted_at >= created_at
        and accepted_at < expires_at)
    or (select pg_catalog.count(*) <> 1 from public.time_entries
      where id = ${entry} and organization_id = ${organization}
        and membership_id = ${employeeMembership} and worksite_id = ${worksite}
        and isfinite(started_at) and isfinite(ended_at) and isfinite(created_at)
        and created_at = started_at and ended_at >= started_at
        and created_at >= ${boundary} and version = 1 and origin = 'clock'
        and last_correction_request_id is null)
    or (select pg_catalog.count(*) <> 2 from public.time_breaks
      where id = any(${breaks}) and organization_id = ${organization}
        and employee_membership_id = ${employeeMembership} and worksite_id = ${worksite}
        and time_entry_id = ${entry} and isfinite(started_at) and isfinite(ended_at)
        and created_at = started_at and ended_at > started_at
        and created_at >= ${boundary} and version = 2 and origin = 'live')
    or exists (select 1 from public.time_breaks as candidate
      where candidate.id = any(${breaks}) and not exists (
        select 1 from public.time_entries as owned_entry
        where owned_entry.id = ${entry} and owned_entry.started_at < candidate.started_at
          and candidate.ended_at <= owned_entry.ended_at))
    or exists (select 1 from public.time_breaks as left_break
      join public.time_breaks as right_break on left_break.id <> right_break.id
      where left_break.id = any(${breaks}) and right_break.id = any(${breaks})
        and left_break.started_at < right_break.started_at
        and left_break.ended_at > right_break.started_at)
    or (select pg_catalog.count(*) <> 2 from private.time_clock_requests
      where request_id = any(${clockRequests}) and membership_id = ${employeeMembership}
        and worksite_id = ${worksite} and time_entry_id = ${entry}
        and processed_at >= ${boundary})
    or (select pg_catalog.count(*) <> 1 from private.time_clock_requests as request
      join public.time_entries as owned_entry on owned_entry.id = request.time_entry_id
      where request.request_id = any(${clockRequests}) and request.operation = 'clock_in'
        and request.result_code = 'started' and request.membership_id = ${employeeMembership}
        and request.worksite_id = ${worksite} and request.started_at = owned_entry.started_at
        and request.ended_at is null and request.processed_at = owned_entry.started_at)
    or (select pg_catalog.count(*) <> 1 from private.time_clock_requests as request
      join public.time_entries as owned_entry on owned_entry.id = request.time_entry_id
      where request.request_id = any(${clockRequests}) and request.operation = 'clock_out'
        and request.result_code = 'stopped' and request.membership_id = ${employeeMembership}
        and request.worksite_id = ${worksite} and request.started_at = owned_entry.started_at
        and request.ended_at = owned_entry.ended_at
        and request.processed_at = owned_entry.ended_at)
    or (select pg_catalog.count(*) <> 4 from private.time_break_operations
      where request_id = any(${breakOperations}) and organization_id = ${organization}
        and employee_membership_id = ${employeeMembership} and processed_at >= ${boundary}
        and payload_hash = pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(${employee}, ${employeeMembership}, operation)::text,
          'UTF8')) and result ->> 'request_id' = request_id::text
        and result ->> 'time_entry_id' = ${sqlText(descriptor.timeEntryId)})
    or exists (select 1 from (values ${descriptor.breakIds
      .map((id) => `(${sqlUuid(id)})`)
      .join(", ")}) as expected_break(id)
      where (select pg_catalog.count(*) from private.time_break_operations as operation_record
        join public.time_breaks as owned_break
          on owned_break.id::text = operation_record.result ->> 'break_id'
        where owned_break.id = expected_break.id
          and operation_record.request_id = any(${breakOperations})
          and operation_record.operation = 'start_break'
          and operation_record.result ->> 'result_code' = 'started'
          and (operation_record.result ->> 'did_transition')::boolean
          and (operation_record.result ->> 'version')::integer = 1
          and (operation_record.result ->> 'started_at')::timestamptz = owned_break.started_at
          and operation_record.result ->> 'ended_at' is null
          and operation_record.processed_at = owned_break.started_at) <> 1
        or (select pg_catalog.count(*) from private.time_break_operations as operation_record
        join public.time_breaks as owned_break
          on owned_break.id::text = operation_record.result ->> 'break_id'
        where owned_break.id = expected_break.id
          and operation_record.request_id = any(${breakOperations})
          and operation_record.operation = 'end_break'
          and operation_record.result ->> 'result_code' = 'ended'
          and (operation_record.result ->> 'did_transition')::boolean
          and (operation_record.result ->> 'version')::integer = 2
          and (operation_record.result ->> 'started_at')::timestamptz = owned_break.started_at
          and (operation_record.result ->> 'ended_at')::timestamptz = owned_break.ended_at
          and operation_record.processed_at = owned_break.ended_at) <> 1)
    or (select pg_catalog.count(*) <> 9 from public.audit_events
      where id = any(${audits}) and organization_id = ${organization}
        and actor_user_id in (${manager}, ${employee}) and actor_type = 'user'
        and created_at >= ${boundary})
    or (select pg_catalog.count(*) <> 1 from public.audit_events
      where id = any(${audits}) and actor_user_id = ${manager}
        and entity_type = 'manager_mfa' and entity_id = ${managerMembership}
        and action = 'manager_mfa.registered' and before_data is null
        and after_data = '{"state":"registered","factor_type":"totp"}'::jsonb)
    or (select pg_catalog.count(*) <> 1 from public.audit_events
      where id = any(${audits}) and actor_user_id = ${manager}
        and entity_type = 'invitation' and entity_id = ${invitation}
        and action = 'employee_invitation.created' and before_data is null
        and after_data = '{"status":"pending","role":"employee"}'::jsonb)
    or (select pg_catalog.count(*) <> 1 from public.audit_events
      where id = any(${audits}) and actor_user_id = ${employee}
        and entity_type = 'invitation' and entity_id = ${invitation}
        and action = 'employee_invitation.accepted' and before_data is null
        and after_data = pg_catalog.jsonb_build_object('status', 'accepted',
          'membership_id', ${employeeMembership}))
    or (select pg_catalog.count(*) <> 1 from public.audit_events
      where id = any(${audits}) and actor_user_id = ${employee}
        and entity_type = 'time_entry' and entity_id = ${entry}
        and action = 'time_entry.clocked_in' and before_data is null
        and after_data = '{"state":"working"}'::jsonb)
    or (select pg_catalog.count(*) <> 1 from public.audit_events
      where id = any(${audits}) and actor_user_id = ${employee}
        and entity_type = 'time_entry' and entity_id = ${entry}
        and action = 'time_entry.clocked_out'
        and before_data = '{"state":"working"}'::jsonb
        and after_data = '{"state":"stopped"}'::jsonb)
    or exists (select 1 from public.time_breaks as owned_break
      where owned_break.id = any(${breaks}) and (
        (select pg_catalog.count(*) from public.audit_events
          where id = any(${audits}) and actor_user_id = ${employee}
            and entity_type = 'time_break' and entity_id = owned_break.id
            and action = 'time_break.started' and before_data is null
            and after_data = pg_catalog.jsonb_build_object('break_id', owned_break.id,
              'time_entry_id', ${entry}, 'status', 'open',
              'started_at', owned_break.started_at, 'ended_at', null,
              'version', 1)) <> 1
        or (select pg_catalog.count(*) from public.audit_events
          where id = any(${audits}) and actor_user_id = ${employee}
            and entity_type = 'time_break' and entity_id = owned_break.id
            and action = 'time_break.ended' and before_data is null
            and after_data = pg_catalog.jsonb_build_object('break_id', owned_break.id,
              'time_entry_id', ${entry}, 'status', 'closed',
              'started_at', owned_break.started_at, 'ended_at', owned_break.ended_at,
              'version', 2)) <> 1))
    or (select pg_catalog.count(*) <> 1 from auth.mfa_factors
      where id = ${factor} and user_id = ${manager} and factor_type = 'totp'
        and status = 'verified' and created_at >= ${boundary})
    or (select pg_catalog.count(*) <> 1 from private.manager_mfa_registrations
      where auth_user_id = ${manager} and provider_factor_id = ${factor}
        and registered_at >= ${boundary} and generation = 1
        and session_cutoff_at is null)
    or exists (select 1 from public.correction_requests
      where organization_id = ${organization} or target_time_entry_id = ${entry})
    or exists (select 1 from public.break_correction_requests
      where organization_id = ${organization} or time_entry_id = ${entry})
    or exists (select 1 from public.time_break_revisions
      where organization_id = ${organization} or time_entry_id = ${entry})
  then
    raise exception using errcode = '42501',
      message = 'preserved_fixture_exact_snapshot_unverified';
  end if;

`;
}

export function buildPreservedFixtureCleanupSql(lease) {
  const generic = buildLocalAuthCleanupSql(lease);
  const anchor = "  if not exists (\n    select 1 from auth.users as auth_user";
  const resultAnchor =
    "select pg_catalog.json_build_object('status', 'database_cleaned');";
  if (generic.split(anchor).length !== 2 || generic.split(resultAnchor).length !== 2) {
    throw recoveryError();
  }
  return generic
    .replace(anchor, `${buildLockedExactGuard(lease)}${anchor}`)
    .replace(
      resultAnchor,
      "select pg_catalog.json_build_object('status', 'database_cleaned', 'triggerState', 'enabled');",
    );
}

function safeEvidence(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const words = key
      .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .split(/[^A-Za-z0-9]+/u)
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    if (words.some((word) => forbiddenEvidenceWords.has(word))) {
      throw recoveryError();
    }
    if (nested && typeof nested === "object") safeEvidence(nested);
  }
}

function evidenceInstant(now) {
  const value = now();
  return instant(value instanceof Date ? value.toISOString() : value);
}

function evidenceLease(lease, redactProof = false) {
  return {
    cleanup: lease.cleanup.database,
    employeeUserId: lease.employee.userId,
    managerUserId: lease.manager.userId,
    organizationId: lease.organization.id,
    proof: redactProof ? null : lease.proof,
    proofStatus: redactProof ? "redacted_after_cleanup" : "retained_for_recovery",
    runId: lease.runId,
    startedAt: lease.startedAt,
  };
}

function evidenceSnapshot({
  checkpoints,
  confirmations,
  createdAt,
  currentPhase,
  failure = null,
  lease,
  now,
  redactProof = false,
  resourcesRemaining = true,
  status,
}) {
  const value = {
    checkpoints,
    confirmations,
    createdAt,
    currentPhase,
    failure,
    identities: {
      auditEventIds: preservedUxFixtureRecoveryDescriptor.auditEventIds,
      breakIds: preservedUxFixtureRecoveryDescriptor.breakIds,
      breakOperationIds: preservedUxFixtureRecoveryDescriptor.breakOperationIds,
      clockRequestIds: preservedUxFixtureRecoveryDescriptor.clockRequestIds,
      employeeMembershipId: preservedUxFixtureRecoveryDescriptor.employee.membershipId,
      factorId: preservedUxFixtureRecoveryDescriptor.factorId,
      invitationId: preservedUxFixtureRecoveryDescriptor.invitationId,
      managerMembershipId: preservedUxFixtureRecoveryDescriptor.manager.membershipId,
      timeEntryId: preservedUxFixtureRecoveryDescriptor.timeEntryId,
      worksiteId: preservedUxFixtureRecoveryDescriptor.worksite.id,
    },
    lease: evidenceLease(lease, redactProof),
    preservationSha256: preservedUxFixtureRecoveryDescriptor.preservationSha256,
    resourcesRemaining,
    schema: recoverySchema,
    status,
    updatedAt: now,
    version: recoveryVersion,
  };
  safeEvidence(value);
  return value;
}

function sanitizedFailure(error) {
  const name =
    typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]*Error$/u.test(error.name)
      ? error.name
      : "Error";
  return {
    message: "Preserved fixture recovery failed; remaining resources were preserved.",
    name,
  };
}

export async function writePreservedFixtureRecoveryEvidenceAtomic(filePath, evidence) {
  safeEvidence(evidence);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const pendingPath = `${filePath}.next`;
  let handle;
  let replaced = false;
  try {
    handle = await open(pendingPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(pendingPath, 0o600);
    await rename(pendingPath, filePath);
    replaced = true;
    if (process.platform !== "win32") {
      const mode = (await stat(filePath)).mode & 0o077;
      if (mode !== 0) throw recoveryError();
      const directory = await open(path.dirname(filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    if ((await readFile(filePath, "utf8")) !== serialized) throw recoveryError();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (!replaced) await unlink(pendingPath).catch(() => {});
    throw new LocalAuthError(
      "Preserved fixture recovery evidence could not be updated safely.",
      { cause: error },
    );
  }
}

export async function createPreservedFixtureRecoveryEvidence({
  lease,
  now = () => new Date(),
  temporaryRoot = tmpdir(),
  writeAtomic = writePreservedFixtureRecoveryEvidenceAtomic,
}) {
  const root = path.resolve(temporaryRoot);
  const systemRoot = path.resolve(tmpdir());
  const relative = path.relative(systemRoot, root);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw recoveryError();
  const parent = path.join(root, "cloxa-preserved-fixture-recovery");
  const directory = path.join(parent, lease.runId);
  const filePath = path.join(directory, "recovery.json");
  await mkdir(parent, { mode: 0o700, recursive: true });
  await mkdir(directory, { mode: 0o700, recursive: false });
  await chmod(directory, 0o700);

  const createdAt = evidenceInstant(now);
  let checkpoints = [{ at: createdAt, phase: "proof_confirmed" }];
  let confirmations = {
    databaseCleaned: false,
    employeeAuthDeleted: false,
    managerAuthDeleted: false,
    snapshotProven: true,
    triggersConfirmedEnabled: false,
  };
  let currentPhase = "proof_confirmed";
  let state = evidenceSnapshot({
    checkpoints,
    confirmations,
    createdAt,
    currentPhase,
    lease,
    now: createdAt,
    status: "active",
  });
  await writeAtomic(filePath, state);

  async function checkpoint(phase, confirmation = {}) {
    const at = evidenceInstant(now);
    checkpoints = [...checkpoints, { at, phase }];
    confirmations = { ...confirmations, ...confirmation };
    currentPhase = phase;
    state = evidenceSnapshot({
      checkpoints,
      confirmations,
      createdAt,
      currentPhase,
      lease,
      now: at,
      status: "active",
    });
    await writeAtomic(filePath, state);
  }

  async function fail(error) {
    const at = evidenceInstant(now);
    state = evidenceSnapshot({
      checkpoints: [
        ...checkpoints,
        { at, lastConfirmedPhase: currentPhase, phase: "failed" },
      ],
      confirmations,
      createdAt,
      currentPhase,
      failure: { at, ...sanitizedFailure(error) },
      lease,
      now: at,
      resourcesRemaining: true,
      status: "failed",
    });
    await writeAtomic(filePath, state);
  }

  async function complete() {
    if (
      !confirmations.databaseCleaned ||
      !confirmations.employeeAuthDeleted ||
      !confirmations.managerAuthDeleted ||
      !confirmations.triggersConfirmedEnabled ||
      lease.cleanup.database !== "cleaned" ||
      lease.employee.state !== "deleted" ||
      lease.manager.state !== "deleted"
    ) {
      throw stoppedError();
    }
    const at = evidenceInstant(now);
    state = evidenceSnapshot({
      checkpoints: [...checkpoints, { at, phase: "cleaned" }],
      confirmations,
      createdAt,
      currentPhase: "cleaned",
      lease,
      now: at,
      redactProof: true,
      resourcesRemaining: false,
      status: "cleaned",
    });
    await writeAtomic(filePath, state);
  }

  return { checkpoint, complete, fail, path: filePath, state: () => state };
}

export async function executePreservedFixtureRecovery(
  parsed,
  { database, evidenceFactory = createPreservedFixtureRecoveryEvidence, signal, store },
) {
  if (
    parsed?.runId !== preservedUxFixtureRecoveryDescriptor.runId ||
    parsed.organizationId !== preservedUxFixtureRecoveryDescriptor.organization.id ||
    parsed.managerUserId !== preservedUxFixtureRecoveryDescriptor.manager.userId ||
    parsed.employeeUserId !== preservedUxFixtureRecoveryDescriptor.employee.userId ||
    parsed.preservationSha256 !==
      preservedUxFixtureRecoveryDescriptor.preservationSha256 ||
    !database ||
    !store
  ) {
    throw recoveryError();
  }

  let evidence;
  try {
    const managerUser = await store.getUser(parsed.managerUserId);
    const employeeUser = await store.getUser(parsed.employeeUserId);
    const managerFactors = await store.listFactors(parsed.managerUserId);
    const employeeFactors = await store.listFactors(parsed.employeeUserId);
    const lease = reconstructPreservedFixtureLease({
      employeeFactors,
      employeeUser,
      managerFactors,
      managerUser,
    });
    const catalog = validatePreservedFixtureCatalog(
      await database.read(buildPreservedFixtureCatalogSql(), { signal }),
    );
    const snapshot = await database.read(buildPreservedFixtureSnapshotSql(catalog), {
      signal,
    });
    validatePreservedFixtureSnapshot(snapshot, lease);
    const cleanupSql = buildPreservedFixtureCleanupSql(lease);
    evidence = await evidenceFactory({ lease });

    const trackedDatabase = {
      async cleanup(currentLease, options) {
        if (currentLease !== lease) throw recoveryError();
        const result = await database.cleanup(cleanupSql, options);
        if (
          result?.status !== "database_cleaned" ||
          result.triggerState !== "enabled"
        ) {
          throw stoppedError();
        }
        await evidence.checkpoint("triggers_confirmed_enabled", {
          triggersConfirmedEnabled: true,
        });
        await evidence.checkpoint("database_cleaned", { databaseCleaned: true });
        return result;
      },
    };
    const trackedStore = {
      ...store,
      async deleteUser(userId) {
        await store.deleteUser(userId);
        if (userId === lease.employee.userId) {
          await evidence.checkpoint("employee_auth_deleted", {
            employeeAuthDeleted: true,
          });
        } else if (userId === lease.manager.userId) {
          await evidence.checkpoint("manager_auth_deleted", {
            managerAuthDeleted: true,
          });
        } else {
          throw recoveryError();
        }
      },
    };
    const result = await cleanupLocalAuthE2eLease(lease, {
      database: trackedDatabase,
      signal,
      store: trackedStore,
    });
    if (result.status !== "cleaned" || result.remaining.length !== 0) {
      throw stoppedError();
    }
    await evidence.complete();
    return {
      evidencePath: evidence.path,
      organizationId: descriptor.organization.id,
      runId: descriptor.runId,
      status: "cleaned",
    };
  } catch (error) {
    if (evidence) await evidence.fail(error).catch(() => {});
    if (error instanceof LocalAuthError) throw error;
    throw stoppedError();
  }
}

function createOperatorDatabase(settings) {
  const run = (sql, { signal } = {}) =>
    runOperatorSqlAsync(sql, {
      dockerEndpoint: settings.dockerEndpoint,
      environment: settings.dockerEnvironment,
      signal,
      timeoutMs: localAuthFixtureDeadlines.sqlMs,
    });
  return {
    cleanup: run,
    read: run,
  };
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parsePreservedFixtureRecoveryArguments(args);
  loadLocalEnvironment();
  const settings = await validateLocalOperatorEnvironment();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    localAuthFixtureDeadlines.operationMs,
  );
  try {
    const requireFromWeb = createRequire(
      path.join(projectRoot, "apps", "web", "package.json"),
    );
    const { createClient } = requireFromWeb("@supabase/supabase-js");
    const fixtureFetch = createLocalAuthFixtureFetch({
      fetchImplementation: localOnlyFetch,
      signal: controller.signal,
    });
    const admin = createClient(settings.supabaseUrl, settings.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: fixtureFetch },
    });
    const store = createSupabaseFixtureStore(admin, { signal: controller.signal });
    const result = await executePreservedFixtureRecovery(parsed, {
      database: createOperatorDatabase(settings),
      signal: controller.signal,
      store,
    });
    console.log(
      JSON.stringify({
        evidencePath: result.evidencePath,
        organizationId: result.organizationId,
        runId: result.runId,
        status: result.status,
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof LocalAuthError
        ? error.message
        : "Preserved fixture recovery failed. Credentials and private state were withheld.",
    );
    process.exitCode = 1;
  });
}
