import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  loadLocalEnvironment,
  requireLocalPassword,
} from "../scripts/local-auth-config.mjs";
import {
  buildLocalAuthCleanupSql,
  cleanupLocalAuthE2eLease,
  createLocalAuthE2eOperation,
  createLocalAuthE2eLease,
  createLocalAuthFixtureFetch,
  createLocalAuthFixtureDatabase,
  createSupabaseFixtureStore,
  localAuthFixtureDeadlines,
  provisionLocalAuthManager,
} from "../scripts/local-auth-e2e-fixture.mjs";
import {
  runOperatorSqlAsync,
  validateLocalOperatorEnvironment,
} from "../scripts/local-manager-mfa-recovery.mjs";

const databaseContainer = "supabase_db_cloxa2";
const maxOutputBytes = 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const applicationNamePattern = /^[a-z][a-z0-9_]{0,62}$/u;
const expectedInvitationConstraint = "invitations_organization_id_fkey";

export const nativeHarnessDeadlines = Object.freeze({
  childMs: 20_000,
  finalDrainMs: 1_000,
  gateReadyMs: 2_000,
  observerMs: 2_000,
  observerProcessMs: 1_000,
  pollAttempts: 40,
  pollDelayMs: 50,
  scenarioMs: 25_000,
});

class NativeHarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "NativeHarnessError";
  }
}

function sqlText(value) {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value)) {
    throw new NativeHarnessError("Native verification identifier is invalid.");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new NativeHarnessError("Native verification UUID is invalid.");
  }
  return `${sqlText(value.toLowerCase())}::uuid`;
}

function requireApplicationName(value) {
  if (typeof value !== "string" || !applicationNamePattern.test(value)) {
    throw new NativeHarnessError("Native verification application name is invalid.");
  }
  return value;
}

function signedInt32(hex) {
  const unsigned = Number.parseInt(hex, 16);
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

export function createNativeSessionIdentity(runId) {
  if (typeof runId !== "string" || !uuidPattern.test(runId)) {
    throw new NativeHarnessError("Native verification run ID is invalid.");
  }
  const token = runId.replaceAll("-", "").slice(0, 12).toLowerCase();
  const compact = runId.replaceAll("-", "");
  return {
    cleanupApplication: `cloxa_native_cleanup_${token}`,
    gateApplication: `cloxa_native_gate_${token}`,
    gateKey: [signedInt32(compact.slice(0, 8)), signedInt32(compact.slice(8, 16))],
    insertApplication: `cloxa_native_insert_${token}`,
    refusalApplication: `cloxa_native_refusal_${token}`,
    rollbackApplication: `cloxa_native_rollback_${token}`,
  };
}

export function parsePostgresErrorEvidence(stderr) {
  const source = typeof stderr === "string" ? stderr : "";
  const sqlstate = /(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/u.exec(source)?.[1] ?? null;
  const constraint = /constraint\s+"([a-z0-9_]+)"/iu.exec(source)?.[1] ?? null;
  return {
    constraint,
    ownershipRefused: source.includes("local_auth_fixture_ownership_unverified"),
    sqlstate,
  };
}

export function withDeadline(
  operation,
  {
    clearTimer = clearTimeout,
    label,
    onTimeout = () => {},
    setTimer = setTimeout,
    timeoutMs,
  },
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new NativeHarnessError("Native verification deadline is invalid.");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout();
      } finally {
        reject(new NativeHarnessError(`${label} timed out safely.`));
      }
    }, timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error);
      },
    );
  });
}

function parseJsonLine(line) {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function startBoundedOperatorSql({
  clearTimer = clearTimeout,
  forceTerminationMs = 500,
  gracefulTerminationMs = 100,
  label,
  settings,
  setTimer = setTimeout,
  spawnCommand = spawn,
  timeoutMs = nativeHarnessDeadlines.childMs,
}) {
  if (!settings?.dockerEndpoint || !settings?.dockerEnvironment) {
    throw new NativeHarnessError(
      "Native verification Docker settings are unavailable.",
    );
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new NativeHarnessError("Native verification child deadline is invalid.");
  }
  if (
    !Number.isSafeInteger(gracefulTerminationMs) ||
    gracefulTerminationMs <= 0 ||
    !Number.isSafeInteger(forceTerminationMs) ||
    forceTerminationMs <= 0
  ) {
    throw new NativeHarnessError(
      "Native verification termination deadline is invalid.",
    );
  }

  let child;
  try {
    child = spawnCommand(
      "docker",
      [
        "--host",
        settings.dockerEndpoint,
        "exec",
        "-i",
        databaseContainer,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: settings.dockerEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    throw new NativeHarnessError(`${label} could not start safely.`);
  }

  let errorEvidence = parsePostgresErrorEvidence("");
  let exitConfirmed = false;
  let exitSettled = false;
  let failureMessage;
  let forceTimer;
  let gracefulTimer;
  let lineBuffer = "";
  let resultSettled = false;
  let stderr = "";
  let stdout = "";
  let timer;
  let resolveExit;
  let resolveResult;
  let rejectResult;
  const jsonValues = [];
  const waiters = new Set();

  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  void result.catch(() => {});
  const exit = new Promise((resolve) => {
    resolveExit = resolve;
  });

  function clearWaiter(waiter) {
    if (waiter.timer !== undefined) clearTimer(waiter.timer);
    waiters.delete(waiter);
  }

  function notifyJson(value) {
    jsonValues.push(value);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(value)) continue;
      clearWaiter(waiter);
      waiter.resolve(value);
    }
  }

  function consumeLines(flush = false) {
    const lines = lineBuffer.split(/\r?\n/u);
    lineBuffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const value = parseJsonLine(line.trim());
      if (value) notifyJson(value);
    }
    if (flush && lineBuffer.trim()) {
      const value = parseJsonLine(lineBuffer.trim());
      if (value) notifyJson(value);
    }
  }

  function removeListeners() {
    child.removeListener("close", onClose);
    child.removeListener("error", onError);
    child.stdout.removeListener("data", onStdout);
    child.stderr.removeListener("data", onStderr);
    child.stdin.removeListener("error", onStdinError);
  }

  function rejectWaiters(message) {
    for (const waiter of [...waiters]) {
      clearWaiter(waiter);
      waiter.reject(new NativeHarnessError(message));
    }
  }

  function settleExit(confirmed, code = null, signal = null) {
    if (exitSettled) return;
    exitSettled = true;
    resolveExit({ code, confirmed, signal });
  }

  function settleFailure(message) {
    if (resultSettled) return;
    resultSettled = true;
    rejectWaiters(message);
    rejectResult(new NativeHarnessError(message));
  }

  function signalOwnedChild(signal) {
    try {
      child.kill(signal);
    } catch {
      // Owned child may already have exited.
    }
  }

  function beginTermination(message) {
    if (exitConfirmed || failureMessage) return;
    failureMessage = message;
    if (timer !== undefined) clearTimer(timer);
    rejectWaiters(message);
    signalOwnedChild("SIGTERM");
    gracefulTimer = setTimer(() => {
      if (exitConfirmed) return;
      signalOwnedChild("SIGKILL");
      if (exitConfirmed) return;
      forceTimer = setTimer(() => {
        if (exitConfirmed) return;
        settleExit(false);
        settleFailure(`${message} Owned process termination was not confirmed.`);
      }, forceTerminationMs);
    }, gracefulTerminationMs);
  }

  function onStdout(chunk) {
    if (failureMessage) return;
    stdout += chunk;
    lineBuffer += chunk;
    if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) {
      beginTermination(`${label} exceeded its bounded output.`);
      return;
    }
    consumeLines();
  }

  function onStderr(chunk) {
    if (failureMessage) return;
    stderr += chunk;
    if (Buffer.byteLength(stderr, "utf8") > maxOutputBytes) {
      beginTermination(`${label} exceeded its bounded error output.`);
    }
  }

  function onStdinError() {
    beginTermination(`${label} input failed safely.`);
  }

  function onError() {
    beginTermination(`${label} failed safely.`);
  }

  function onClose(code, signal) {
    if (exitConfirmed) return;
    exitConfirmed = true;
    consumeLines(true);
    if (timer !== undefined) clearTimer(timer);
    if (gracefulTimer !== undefined) clearTimer(gracefulTimer);
    if (forceTimer !== undefined) clearTimer(forceTimer);
    removeListeners();
    errorEvidence = parsePostgresErrorEvidence(stderr);
    settleExit(true, code, signal ?? null);
    if (failureMessage) {
      settleFailure(failureMessage);
    } else if (!resultSettled) {
      resultSettled = true;
      rejectWaiters(`${label} ended before expected evidence appeared.`);
      resolveResult({
        code,
        errorEvidence,
        jsonValues: [...jsonValues],
        signal: signal ?? null,
      });
    }
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.on("close", onClose);
  child.on("error", onError);
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.stdin.on("error", onStdinError);
  timer = setTimer(() => {
    beginTermination(`${label} timed out safely.`);
  }, timeoutMs);

  return {
    cancel() {
      beginTermination(`${label} was cancelled safely.`);
    },
    end(sql = "") {
      if (resultSettled || failureMessage) {
        throw new NativeHarnessError(`${label} is no longer writable.`);
      }
      try {
        child.stdin.end(sql);
      } catch {
        beginTermination(`${label} input failed safely.`);
      }
    },
    exit,
    get exitConfirmed() {
      return exitConfirmed;
    },
    get settled() {
      return resultSettled;
    },
    result,
    waitForJson(predicate, waitTimeoutMs) {
      const existing = jsonValues.find(predicate);
      if (existing) return Promise.resolve(existing);
      if (resultSettled || failureMessage) {
        return Promise.reject(
          new NativeHarnessError(`${label} ended before expected evidence appeared.`),
        );
      }
      return new Promise((resolve, reject) => {
        const waiter = { predicate, reject, resolve, timer: undefined };
        waiter.timer = setTimer(() => {
          clearWaiter(waiter);
          reject(new NativeHarnessError(`${label} evidence timed out safely.`));
        }, waitTimeoutMs);
        waiters.add(waiter);
      });
    },
    write(sql) {
      if (resultSettled || failureMessage) {
        throw new NativeHarnessError(`${label} is no longer writable.`);
      }
      try {
        child.stdin.write(sql);
      } catch {
        beginTermination(`${label} input failed safely.`);
      }
    },
  };
}

function buildGateSql(identity) {
  const [key1, key2] = identity.gateKey;
  return `begin;
set local application_name = ${sqlText(requireApplicationName(identity.gateApplication))};
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '20s';
select pg_catalog.pg_advisory_lock(${key1}, ${key2});
select pg_catalog.json_build_object(
  'status', 'gate_held',
  'application_name', pg_catalog.current_setting('application_name'),
  'backend_pid', pg_catalog.pg_backend_pid()
);\n`;
}

function buildGateReleaseSql(identity) {
  const [key1, key2] = identity.gateKey;
  return `select pg_catalog.json_build_object(
  'status', case when pg_catalog.pg_advisory_unlock(${key1}, ${key2})
    then 'gate_released' else 'gate_release_failed' end
);
commit;\n`;
}

export function buildControlledCleanupSql(lease, identity) {
  const cleanupSql = buildLocalAuthCleanupSql(lease);
  const start = "begin;\n";
  const proofBoundary = "\nend;\n$cloxa_local_auth_fixture$;";
  assert.equal(cleanupSql.split(start).length, 2);
  assert.equal(cleanupSql.split(proofBoundary).length, 2);
  return cleanupSql
    .replace(
      start,
      `${start}set local application_name = ${sqlText(
        requireApplicationName(identity.cleanupApplication),
      )};\n`,
    )
    .replace(
      proofBoundary,
      `\n  perform pg_catalog.pg_advisory_xact_lock(${identity.gateKey[0]}, ${
        identity.gateKey[1]
      });${proofBoundary}`,
    );
}

function buildConcurrentInsertSql(lease, identity, concurrentEmail) {
  return `begin;
set local application_name = ${sqlText(requireApplicationName(identity.insertApplication))};
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '20s';
create temporary table cloxa_native_insert_result (
  status text not null,
  sqlstate text,
  constraint_name text
) on commit drop;
do $cloxa_native_insert$
declare
  caught_constraint text;
  caught_sqlstate text;
begin
  begin
    insert into public.invitations (
      organization_id, normalized_email, intended_role, status, invited_by, expires_at
    ) values (
      ${sqlUuid(lease.organization.id)}, ${sqlText(concurrentEmail)}, 'employee', 'pending',
      ${sqlUuid(lease.manager.userId)}, pg_catalog.now() + interval '1 hour'
    );
    insert into pg_temp.cloxa_native_insert_result(status)
    values ('unexpected_insert');
  exception when others then
    get stacked diagnostics
      caught_constraint = constraint_name,
      caught_sqlstate = returned_sqlstate;
    insert into pg_temp.cloxa_native_insert_result(status, sqlstate, constraint_name)
    values ('database_rejected', caught_sqlstate, caught_constraint);
  end;
end;
$cloxa_native_insert$;
select pg_catalog.json_build_object(
  'status', status,
  'sqlstate', sqlstate,
  'constraint', constraint_name
)
from pg_temp.cloxa_native_insert_result;
rollback;`;
}

function buildCleanupGateObservationSql(identity) {
  return `with cleanup as (
  select activity.pid
  from pg_catalog.pg_stat_activity as activity
  where activity.datname = pg_catalog.current_database()
    and activity.application_name = ${sqlText(identity.cleanupApplication)}
)
select pg_catalog.json_build_object(
  'status', 'cleanup_gate_observation',
  'cleanup_count', (select pg_catalog.count(*) from cleanup),
  'cleanup_pid', (select pg_catalog.min(pid) from cleanup),
  'cleanup_blockers', coalesce(
    (select pg_catalog.to_jsonb(pg_catalog.pg_blocking_pids(pid)) from cleanup),
    '[]'::jsonb
  ),
  'organization_lock_granted', exists (
    select 1 from pg_catalog.pg_locks as held
    join cleanup on cleanup.pid = held.pid
    where held.relation = 'public.organizations'::pg_catalog.regclass
      and held.mode = 'ShareRowExclusiveLock' and held.granted
  )
);`;
}

function buildInsertWaitObservationSql(identity) {
  return `with cleanup as (
  select activity.pid
  from pg_catalog.pg_stat_activity as activity
  where activity.datname = pg_catalog.current_database()
    and activity.application_name = ${sqlText(identity.cleanupApplication)}
), insertion as (
  select activity.pid, activity.wait_event_type
  from pg_catalog.pg_stat_activity as activity
  where activity.datname = pg_catalog.current_database()
    and activity.application_name = ${sqlText(identity.insertApplication)}
)
select pg_catalog.json_build_object(
  'status', 'insert_wait_observation',
  'cleanup_count', (select pg_catalog.count(*) from cleanup),
  'cleanup_pid', (select pg_catalog.min(pid) from cleanup),
  'insert_count', (select pg_catalog.count(*) from insertion),
  'insert_pid', (select pg_catalog.min(pid) from insertion),
  'insert_wait_event_type', (select pg_catalog.min(wait_event_type) from insertion),
  'insert_blockers', coalesce(
    (select pg_catalog.to_jsonb(pg_catalog.pg_blocking_pids(pid)) from insertion),
    '[]'::jsonb
  ),
  'cleanup_invitation_lock_granted', exists (
    select 1 from pg_catalog.pg_locks as held
    join cleanup on cleanup.pid = held.pid
    where held.relation = 'public.invitations'::pg_catalog.regclass
      and held.mode = 'ShareRowExclusiveLock' and held.granted
  ),
  'insert_invitation_lock_waiting', exists (
    select 1 from pg_catalog.pg_locks as waiting
    join insertion on insertion.pid = waiting.pid
    where waiting.relation = 'public.invitations'::pg_catalog.regclass
      and waiting.mode = 'RowExclusiveLock' and not waiting.granted
  )
);`;
}

function ownedManagerSql(lease) {
  return `exists (
    select 1 from auth.users as auth_user
    where auth_user.id = ${sqlUuid(lease.manager.userId)}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_run_id' = ${sqlText(lease.runId)}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_proof' = ${sqlText(lease.proof)}
  ) and exists (
    select 1 from public.organizations
    where id = ${sqlUuid(lease.organization.id)} and name = ${sqlText(lease.organization.name)}
  ) and exists (
    select 1 from public.worksites
    where id = ${sqlUuid(lease.worksite.id)}
      and organization_id = ${sqlUuid(lease.organization.id)}
      and name = ${sqlText(lease.worksite.name)}
  ) and exists (
    select 1 from public.memberships
    where id = ${sqlUuid(lease.managerMembership.id)}
      and organization_id = ${sqlUuid(lease.organization.id)}
      and user_id = ${sqlUuid(lease.manager.userId)}
      and role = 'manager' and status = 'active'
  ) and exists (
    select 1 from public.profiles
    where user_id = ${sqlUuid(lease.manager.userId)}
      and display_name = 'Fictieve lokale E2E-beheerder'
  )`;
}

function triggerEnabledSql() {
  return `exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as class on class.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public' and class.relname = 'audit_events'
      and trigger.tgname = 'audit_events_reject_mutation'
      and trigger.tgenabled = 'O' and not trigger.tgisinternal
  )`;
}

function buildPreservationObservationSql(targetLease, sentinelLease) {
  return `select pg_catalog.json_build_object(
  'status', 'preservation_observation',
  'target_owned', ${ownedManagerSql(targetLease)},
  'sentinel_owned', ${ownedManagerSql(sentinelLease)},
  'trigger_enabled', ${triggerEnabledSql()}
);`;
}

function buildPostconditionSql(targetLease, sentinelLease, concurrentEmail) {
  const targetUsers = `array[${sqlUuid(targetLease.manager.userId)}]`;
  return `select pg_catalog.json_build_object(
  'status', 'postconditions',
  'target_application_absent',
    not exists (select 1 from public.organizations where id = ${sqlUuid(
      targetLease.organization.id,
    )})
    and not exists (select 1 from public.worksites where organization_id = ${sqlUuid(
      targetLease.organization.id,
    )})
    and not exists (select 1 from public.memberships where organization_id = ${sqlUuid(
      targetLease.organization.id,
    )})
    and not exists (select 1 from public.profiles where user_id = any(${targetUsers}))
    and not exists (select 1 from public.invitations where organization_id = ${sqlUuid(
      targetLease.organization.id,
    )})
    and not exists (select 1 from public.audit_events where organization_id = ${sqlUuid(
      targetLease.organization.id,
    )})
    and not exists (
      select 1 from private.manager_mfa_registrations
      where auth_user_id = any(${targetUsers})
    ),
  'target_auth_owned', exists (
    select 1 from auth.users as auth_user
    where auth_user.id = ${sqlUuid(targetLease.manager.userId)}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_run_id' = ${sqlText(
        targetLease.runId,
      )}
      and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture_proof' = ${sqlText(
        targetLease.proof,
      )}
  ),
  'sentinel_owned', ${ownedManagerSql(sentinelLease)},
  'concurrent_invitation_absent', not exists (
    select 1 from public.invitations where normalized_email = ${sqlText(concurrentEmail)}
  ),
  'trigger_enabled', ${triggerEnabledSql()}
);`;
}

export function buildOwnershipRefusalSql(lease, identity) {
  const cleanupSql = buildLocalAuthCleanupSql(lease);
  const proofStart = "do $cloxa_local_auth_fixture$";
  assert.equal(cleanupSql.split(proofStart).length, 2);
  return cleanupSql.replace(
    proofStart,
    `set local application_name = ${sqlText(
      requireApplicationName(identity.refusalApplication),
    )};
update public.worksites
set name = name || ' refusal-probe'
where id = ${sqlUuid(lease.worksite.id)};
${proofStart}`,
  );
}

export function buildTriggerRollbackSql(lease, identity) {
  const cleanupSql = buildLocalAuthCleanupSql(lease);
  const start = "begin;\n";
  const triggerBoundary =
    "alter table public.audit_events disable trigger audit_events_reject_mutation;";
  assert.equal(cleanupSql.split(start).length, 2);
  assert.equal(cleanupSql.split(triggerBoundary).length, 2);
  return cleanupSql
    .replace(
      start,
      `${start}set local application_name = ${sqlText(
        requireApplicationName(identity.rollbackApplication),
      )};\n`,
    )
    .replace(triggerBoundary, `${triggerBoundary}\nselect 1 / 0;`);
}

function exactBlockers(value, expectedPid) {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    Number.isInteger(value[0]) &&
    value[0] === expectedPid
  );
}

function validCleanupGateObservation(value, gatePid) {
  return (
    value?.status === "cleanup_gate_observation" &&
    value.cleanup_count === 1 &&
    Number.isInteger(value.cleanup_pid) &&
    value.cleanup_pid > 0 &&
    value.organization_lock_granted === true &&
    exactBlockers(value.cleanup_blockers, gatePid)
  );
}

function validInsertWaitObservation(value, cleanupPid) {
  return (
    value?.status === "insert_wait_observation" &&
    value.cleanup_count === 1 &&
    value.cleanup_pid === cleanupPid &&
    value.insert_count === 1 &&
    Number.isInteger(value.insert_pid) &&
    value.insert_pid > 0 &&
    value.insert_wait_event_type === "Lock" &&
    value.cleanup_invitation_lock_granted === true &&
    value.insert_invitation_lock_waiting === true &&
    exactBlockers(value.insert_blockers, cleanupPid)
  );
}

async function observeWithDeadline(observe, sql, limits, label) {
  return withDeadline(
    Promise.resolve().then(() => observe(sql)),
    {
      label,
      timeoutMs: limits.observerMs,
    },
  );
}

export async function runObserverSqlSmokeCheck({ deadlines = {}, identity, observe }) {
  const limits = { ...nativeHarnessDeadlines, ...deadlines };
  const cleanup = await observeWithDeadline(
    observe,
    buildCleanupGateObservationSql(identity),
    limits,
    "Native cleanup observer SQL smoke check",
  );
  const insertion = await observeWithDeadline(
    observe,
    buildInsertWaitObservationSql(identity),
    limits,
    "Native insert observer SQL smoke check",
  );
  if (
    cleanup?.status !== "cleanup_gate_observation" ||
    insertion?.status !== "insert_wait_observation"
  ) {
    throw new NativeHarnessError("Native observer SQL smoke check was not confirmed.");
  }
  return { status: "observer_sql_valid" };
}

async function waitForObservation({
  accept,
  active,
  handles,
  label,
  limits,
  observe,
  sleep,
  sql,
}) {
  for (let attempt = 0; attempt < limits.pollAttempts; attempt += 1) {
    if (!active()) throw new NativeHarnessError(`${label} was cancelled safely.`);
    const value = await observeWithDeadline(observe, sql, limits, label);
    if (!active()) throw new NativeHarnessError(`${label} was cancelled safely.`);
    if (accept(value)) return value;
    if (handles.some((handle) => handle.settled)) {
      throw new NativeHarnessError(
        `${label} process ended before proof was established.`,
      );
    }
    await sleep(limits.pollDelayMs);
  }
  throw new NativeHarnessError(`${label} could not be proven.`);
}

export async function drainOwnedSessions(
  sessions,
  { timeoutMs = nativeHarnessDeadlines.finalDrainMs } = {},
) {
  if (sessions.length === 0) return true;
  const cancel = () => {
    for (const session of sessions) {
      try {
        session.cancel();
      } catch {
        // Cancellation is best effort and limited to owned children.
      }
    }
  };
  try {
    const exits = await withDeadline(
      Promise.all(
        sessions.map((session) =>
          session.exit
            ? session.exit
            : session.result.then(
                () => ({ confirmed: true }),
                () => ({ confirmed: true }),
              ),
        ),
      ),
      {
        label: "Native verification child finalization",
        onTimeout: cancel,
        timeoutMs,
      },
    );
    return exits.every((value) => value?.confirmed === true);
  } catch {
    cancel();
    return false;
  }
}

export async function runNativeInterleavingScenario({
  deadlines = {},
  finalizeLease,
  lease,
  observe,
  sentinelLease,
  settings,
  sleep = delay,
  startSession,
}) {
  const limits = { ...nativeHarnessDeadlines, ...deadlines };
  const identity = createNativeSessionIdentity(lease.runId);
  const operation = createLocalAuthE2eOperation(lease);
  const concurrentEmail = `concurrent.${lease.runId}@example.test`;
  const sessions = [];
  let active = true;
  let databaseConfirmed = false;
  let operationCompleted = false;
  const launch =
    startSession ??
    ((options) =>
      startBoundedOperatorSql({
        ...options,
        settings,
      }));

  function own(session) {
    sessions.push(session);
    return session;
  }

  function cancelSessions() {
    active = false;
    operation.abort();
    for (const session of sessions) {
      try {
        session.cancel();
      } catch {
        // Cancellation is best effort and limited to owned children.
      }
    }
  }

  const scenario = (async () => {
    const gate = own(
      launch({ label: "Native verification gate", timeoutMs: limits.childMs }),
    );
    gate.write(buildGateSql(identity));
    const gateHeld = await withDeadline(
      gate.waitForJson((value) => value?.status === "gate_held", limits.gateReadyMs),
      {
        label: "Native verification gate readiness",
        timeoutMs: limits.gateReadyMs,
      },
    );
    if (
      gateHeld.application_name !== identity.gateApplication ||
      !Number.isInteger(gateHeld.backend_pid) ||
      gateHeld.backend_pid <= 0
    ) {
      throw new NativeHarnessError("Native verification gate identity was not proven.");
    }
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");

    const cleanup = own(
      launch({ label: "Native verification cleanup", timeoutMs: limits.childMs }),
    );
    cleanup.end(buildControlledCleanupSql(lease, identity));
    const cleanupObservation = await waitForObservation({
      accept: (value) => validCleanupGateObservation(value, gateHeld.backend_pid),
      active: () => active,
      handles: [cleanup],
      label: "Native cleanup ownership gate",
      limits,
      observe,
      sleep,
      sql: buildCleanupGateObservationSql(identity),
    });
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");

    const insert = own(
      launch({
        label: "Native verification concurrent insert",
        timeoutMs: limits.childMs,
      }),
    );
    insert.end(buildConcurrentInsertSql(lease, identity, concurrentEmail));
    const insertObservation = await waitForObservation({
      accept: (value) =>
        validInsertWaitObservation(value, cleanupObservation.cleanup_pid),
      active: () => active,
      handles: [cleanup, insert],
      label: "Native concurrent insert wait",
      limits,
      observe,
      sleep,
      sql: buildInsertWaitObservationSql(identity),
    });

    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");
    gate.write(buildGateReleaseSql(identity));
    gate.end();

    const [gateResult, cleanupResult, insertResult] = await Promise.all([
      gate.result,
      cleanup.result,
      insert.result,
    ]);
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");
    if (
      gateResult.code !== 0 ||
      !gateResult.jsonValues.some((value) => value?.status === "gate_released")
    ) {
      throw new NativeHarnessError(
        "Native verification gate release was not confirmed.",
      );
    }
    if (
      cleanupResult.code !== 0 ||
      !cleanupResult.jsonValues.some((value) => value?.status === "database_cleaned")
    ) {
      throw new NativeHarnessError("Generated cleanup success was not confirmed.");
    }
    const insertion = insertResult.jsonValues.find(
      (value) =>
        value?.status === "database_rejected" || value?.status === "unexpected_insert",
    );
    if (
      insertResult.code !== 0 ||
      insertion?.status !== "database_rejected" ||
      insertion.sqlstate !== "23503" ||
      insertion.constraint !== expectedInvitationConstraint
    ) {
      throw new NativeHarnessError(
        "Concurrent insert did not produce the exact expected foreign-key rejection.",
      );
    }

    const postconditions = await observeWithDeadline(
      observe,
      buildPostconditionSql(lease, sentinelLease, concurrentEmail),
      limits,
      "Native cleanup postconditions",
    );
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");
    if (
      postconditions?.status !== "postconditions" ||
      postconditions.target_application_absent !== true ||
      postconditions.target_auth_owned !== true ||
      postconditions.sentinel_owned !== true ||
      postconditions.concurrent_invitation_absent !== true ||
      postconditions.trigger_enabled !== true
    ) {
      throw new NativeHarnessError("Native cleanup postconditions were not proven.");
    }

    databaseConfirmed = true;
    lease.cleanup.database = "cleaned";
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");
    const finalCleanup = await finalizeLease({ signal: operation.signal });
    if (!active)
      throw new NativeHarnessError("Native verification was cancelled safely.");
    if (finalCleanup?.status !== "cleaned" || finalCleanup.remaining?.length !== 0) {
      throw new NativeHarnessError("Confirmed fixture Auth cleanup did not complete.");
    }

    operation.finish();
    operationCompleted = true;
    return {
      cleanupBackendPid: cleanupObservation.cleanup_pid,
      insertBackendPid: insertObservation.insert_pid,
      status: "verified",
    };
  })();

  try {
    return await withDeadline(scenario, {
      label: "Native cleanup interleaving scenario",
      onTimeout: cancelSessions,
      timeoutMs: limits.scenarioMs,
    });
  } finally {
    if (!operationCompleted) operation.abort();
    if (!databaseConfirmed) cancelSessions();
    const exitsConfirmed = await drainOwnedSessions(sessions, {
      timeoutMs: limits.finalDrainMs,
    });
    if (!exitsConfirmed) {
      throw new NativeHarnessError(
        "Native verification owned process termination was not confirmed.",
      );
    }
  }
}

async function runExpectedFailureProbe({
  expectedOwnershipRefusal = false,
  expectedSqlstate,
  label,
  settings,
  sql,
}) {
  const session = startBoundedOperatorSql({
    label,
    settings,
    timeoutMs: nativeHarnessDeadlines.childMs,
  });
  try {
    session.end(sql);
    const result = await session.result;
    if (
      result.code === 0 ||
      result.errorEvidence.sqlstate !== expectedSqlstate ||
      (expectedOwnershipRefusal && result.errorEvidence.ownershipRefused !== true)
    ) {
      throw new NativeHarnessError(
        `${label} did not produce expected refusal evidence.`,
      );
    }
  } finally {
    if (!session.settled) session.cancel();
    if (!(await drainOwnedSessions([session]))) {
      throw new NativeHarnessError(`${label} process termination was not confirmed.`);
    }
  }
}

function createObservedSql(settings) {
  return async (sql) =>
    runOperatorSqlAsync(sql, {
      dockerEndpoint: settings.dockerEndpoint,
      environment: settings.dockerEnvironment,
      timeoutMs: nativeHarnessDeadlines.observerProcessMs,
    });
}

function assertPreservedObservation(value) {
  if (
    value?.status !== "preservation_observation" ||
    value.target_owned !== true ||
    value.sentinel_owned !== true ||
    value.trigger_enabled !== true
  ) {
    throw new NativeHarnessError("Native rollback preservation was not proven.");
  }
}

export async function runNativeCleanupVerification(argv = process.argv.slice(2)) {
  const approvals = new Set(argv);
  if (
    approvals.size !== 2 ||
    !approvals.has("--confirm-local-development") ||
    !approvals.has("--confirm-disposable-fixture-mutation")
  ) {
    throw new NativeHarnessError(
      "Usage: node tests/local-auth-e2e-cleanup.postgres.mjs --confirm-local-development --confirm-disposable-fixture-mutation",
    );
  }

  loadLocalEnvironment();
  const settings = await validateLocalOperatorEnvironment();
  const password = requireLocalPassword(
    process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
    "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
  );
  const requireFromWeb = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const { createClient } = requireFromWeb("@supabase/supabase-js");
  const targetLease = createLocalAuthE2eLease();
  const sentinelLease = createLocalAuthE2eLease();
  const targetOperation = createLocalAuthE2eOperation(targetLease, {
    timeoutMs: localAuthFixtureDeadlines.operationMs,
  });
  const sentinelOperation = createLocalAuthE2eOperation(sentinelLease, {
    timeoutMs: localAuthFixtureDeadlines.operationMs,
  });
  const createStore = (operation) => {
    const admin = createClient(settings.supabaseUrl, settings.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: createLocalAuthFixtureFetch({ signal: operation.signal }),
      },
    });
    return createSupabaseFixtureStore(admin, { signal: operation.signal });
  };
  const targetStore = createStore(targetOperation);
  const sentinelStore = createStore(sentinelOperation);
  const database = createLocalAuthFixtureDatabase({
    dockerEndpoint: settings.dockerEndpoint,
    dockerEnvironment: settings.dockerEnvironment,
    runSql: runOperatorSqlAsync,
    timeoutMs: localAuthFixtureDeadlines.sqlMs,
  });
  const identity = createNativeSessionIdentity(targetLease.runId);
  const observe = createObservedSql(settings);
  let completed = false;

  try {
    await runObserverSqlSmokeCheck({ identity, observe });
    await provisionLocalAuthManager(targetLease, { password, store: targetStore });
    await provisionLocalAuthManager(sentinelLease, { password, store: sentinelStore });

    await runExpectedFailureProbe({
      expectedOwnershipRefusal: true,
      expectedSqlstate: "42501",
      label: "Native ownership-refusal probe",
      settings,
      sql: buildOwnershipRefusalSql(targetLease, identity),
    });
    assertPreservedObservation(
      await observeWithDeadline(
        observe,
        buildPreservationObservationSql(targetLease, sentinelLease),
        nativeHarnessDeadlines,
        "Native ownership-refusal postconditions",
      ),
    );

    await runExpectedFailureProbe({
      expectedSqlstate: "22012",
      label: "Native trigger-rollback probe",
      settings,
      sql: buildTriggerRollbackSql(targetLease, identity),
    });
    assertPreservedObservation(
      await observeWithDeadline(
        observe,
        buildPreservationObservationSql(targetLease, sentinelLease),
        nativeHarnessDeadlines,
        "Native trigger-rollback postconditions",
      ),
    );

    await runNativeInterleavingScenario({
      finalizeLease: ({ signal }) =>
        cleanupLocalAuthE2eLease(targetLease, {
          database,
          signal,
          store: targetStore,
        }),
      lease: targetLease,
      observe,
      sentinelLease,
      settings,
    });
    const sentinelCleanup = await cleanupLocalAuthE2eLease(sentinelLease, {
      database,
      signal: sentinelOperation.signal,
      store: sentinelStore,
    });
    if (
      sentinelCleanup.status !== "cleaned" ||
      sentinelCleanup.remaining.length !== 0
    ) {
      throw new NativeHarnessError(
        "Unrelated sentinel fixture cleanup did not complete.",
      );
    }
    sentinelOperation.finish();
    completed = true;
    console.log("Local Auth PostgreSQL cleanup verification passed.");
  } finally {
    if (!completed) {
      targetOperation.abort();
      sentinelOperation.abort();
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    await runNativeCleanupVerification();
  } catch (error) {
    if (error instanceof NativeHarnessError) throw error;
    throw new NativeHarnessError(
      "Native cleanup verification failed safely. Fixture resources were preserved.",
    );
  }
}
