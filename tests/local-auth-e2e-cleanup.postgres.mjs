import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  loadLocalEnvironment,
  requireLocalPassword,
} from "../scripts/local-auth-config.mjs";
import {
  claimLocalAuthEmployee,
  buildLocalAuthCleanupSql,
  cleanupLocalAuthE2eLease,
  createLocalAuthE2eOperation,
  createLocalAuthE2eLease,
  createLocalAuthFixtureFetch,
  createLocalAuthFixtureDatabase,
  createSupabaseFixtureStore,
  localAuthFixtureDeadlines,
  markLocalAuthInvitationAttempted,
  prepareLocalAuthEmployeeInvitation,
  provisionLocalAuthManager,
  verifyAcceptedLocalAuthEmployee,
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
const cleanupTriggerTransitions = Object.freeze([
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
]);

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
  constructor(message, options) {
    super(message, options);
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

const nativeRecoverySchema = "cloxa.native-cleanup-recovery";
const nativeRecoveryVersion = 1;
const forbiddenRecoveryKey =
  /password|secret|token|cookie|mfa|docker|environment|credential/iu;

function allocateNativeUuid(createId, label) {
  const value = createId();
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new NativeHarnessError(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

export function createNativeHarnessAllocation({
  createId = randomUUID,
  now = () => new Date(),
} = {}) {
  const targetLease = createLocalAuthE2eLease({ createId, now });
  const sentinelLease = createLocalAuthE2eLease({ createId, now });
  const employeeMembershipId = allocateNativeUuid(
    createId,
    "Native employee membership ID",
  );
  const invitationId = allocateNativeUuid(createId, "Native invitation ID");
  const graph = createClockGraph(employeeMembershipId, { createId });
  return {
    crossTenantRefusalRequestId: allocateNativeUuid(
      createId,
      "Native cross-tenant refusal request ID",
    ),
    graph,
    identity: createNativeSessionIdentity(targetLease.runId),
    invitationId,
    sentinelLease,
    targetLease,
  };
}

function recoveryInstant(now) {
  const value = now();
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new NativeHarnessError("Native recovery evidence time is invalid.");
  }
  return instant.toISOString();
}

function recoveryLeaseSnapshot(lease, { redactProof = false } = {}) {
  return {
    cleanup: { database: lease.cleanup.database },
    employee: {
      email: lease.employee.email,
      emailAbsent: lease.employee.emailAbsent,
      invitationAttempted: lease.employee.invitationAttempted,
      invitationId: lease.employee.invitationId,
      state: lease.employee.state,
      userId: lease.employee.userId,
    },
    manager: {
      email: lease.manager.email,
      emailAbsent: lease.manager.emailAbsent,
      state: lease.manager.state,
      userId: lease.manager.userId,
    },
    managerMembership: {
      id: lease.managerMembership.id,
      state: lease.managerMembership.state,
    },
    managerProfile: { state: lease.managerProfile.state },
    marker: lease.marker,
    organization: {
      id: lease.organization.id,
      state: lease.organization.state,
    },
    proof: redactProof ? null : lease.proof,
    proofStatus: redactProof ? "redacted_after_cleanup" : "retained_for_recovery",
    runId: lease.runId,
    startedAt: lease.startedAt,
    worksite: { id: lease.worksite.id, state: lease.worksite.state },
  };
}

function assertRecoveryEnvelopeSafe(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenRecoveryKey.test(key)) {
      throw new NativeHarnessError(
        "Native recovery evidence contains a forbidden field.",
      );
    }
    if (nested && typeof nested === "object") assertRecoveryEnvelopeSafe(nested);
  }
}

function sanitizedFailure(error) {
  const candidate =
    typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]*Error$/u.test(error.name)
      ? error.name
      : "Error";
  return {
    message: "Native cleanup phase failed; fixture resources were preserved.",
    name: candidate,
  };
}

function sanitizedCause(error) {
  const failure = sanitizedFailure(error);
  const cause = new Error(failure.message);
  cause.name = failure.name;
  return cause;
}

function recoverySnapshot({
  allocation,
  checkpoints,
  confirmations,
  createdAt,
  currentPhase,
  failure = null,
  now,
  redactProof = false,
  resourcesRemaining = true,
  status,
}) {
  const envelope = {
    allocations: {
      applications: allocation.identity,
      crossTenantRefusalRequestId: allocation.crossTenantRefusalRequestId,
      graph: allocation.graph,
      invitationId: allocation.invitationId,
    },
    checkpoints,
    confirmations,
    createdAt,
    currentPhase,
    failure,
    harness: "local-auth-e2e-native-postgresql-cleanup",
    nativeCleanupHarness: true,
    protection: {
      enforcement: process.platform === "win32" ? "best_effort_on_windows" : "verified",
      requestedDirectoryMode: "0700",
      requestedFileMode: "0600",
    },
    resourcesRemaining,
    schema: nativeRecoverySchema,
    sentinel: recoveryLeaseSnapshot(allocation.sentinelLease, { redactProof }),
    status,
    target: recoveryLeaseSnapshot(allocation.targetLease, { redactProof }),
    updatedAt: now,
    version: nativeRecoveryVersion,
  };
  assertRecoveryEnvelopeSafe(envelope);
  return envelope;
}

function recoveryResourcesAreCleaned(allocation) {
  return (
    allocation.targetLease.cleanup.database === "cleaned" &&
    allocation.targetLease.manager.state === "deleted" &&
    allocation.targetLease.employee.state === "deleted" &&
    allocation.sentinelLease.cleanup.database === "cleaned" &&
    allocation.sentinelLease.manager.state === "deleted" &&
    allocation.sentinelLease.employee.state === "planned" &&
    allocation.sentinelLease.employee.userId === null &&
    allocation.sentinelLease.employee.invitationAttempted === false
  );
}

export async function writeNativeRecoveryEnvelopeAtomic(filePath, envelope) {
  assertRecoveryEnvelopeSafe(envelope);
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
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
      if (mode !== 0) {
        throw new NativeHarnessError(
          "Native recovery evidence permissions were not confirmed.",
        );
      }
      const directory = await open(path.dirname(filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    if ((await readFile(filePath, "utf8")) !== serialized) {
      throw new NativeHarnessError("Native recovery evidence write was not confirmed.");
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (!replaced) await unlink(pendingPath).catch(() => {});
    throw new NativeHarnessError("Native recovery evidence update failed safely.", {
      cause: sanitizedCause(error),
    });
  }
}

export async function createNativeRecoveryEvidence({
  allocation,
  now = () => new Date(),
  temporaryRoot = tmpdir(),
  writeAtomic = writeNativeRecoveryEnvelopeAtomic,
}) {
  const root = path.resolve(temporaryRoot);
  const systemTemporaryRoot = path.resolve(tmpdir());
  const relativeRoot = path.relative(systemTemporaryRoot, root);
  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    throw new NativeHarnessError(
      "Native recovery evidence must remain under the operating-system temporary directory.",
    );
  }
  const parent = path.join(root, "cloxa-native-cleanup-recovery");
  const directory = path.join(parent, allocation.targetLease.runId);
  const filePath = path.join(directory, "recovery.json");
  await mkdir(parent, { mode: 0o700, recursive: true });
  await mkdir(directory, { mode: 0o700, recursive: false });
  await chmod(directory, 0o700);

  const createdAt = recoveryInstant(now);
  let currentPhase = "identities_allocated";
  let confirmations = {
    ownedChildrenStopped: false,
    sentinelCleaned: false,
    targetAuthCleaned: false,
  };
  let checkpoints = [{ at: createdAt, phase: currentPhase }];
  let state = recoverySnapshot({
    allocation,
    checkpoints,
    confirmations,
    createdAt,
    currentPhase,
    now: createdAt,
    status: "active",
  });
  await writeAtomic(filePath, state);

  async function checkpoint(phase, { confirmation, details } = {}) {
    const at = recoveryInstant(now);
    const nextConfirmations = { ...confirmations, ...confirmation };
    const checkpointRecord = { at, phase };
    if (details) checkpointRecord.details = details;
    const nextCheckpoints = [...checkpoints, checkpointRecord];
    const next = recoverySnapshot({
      allocation,
      checkpoints: nextCheckpoints,
      confirmations: nextConfirmations,
      createdAt,
      currentPhase: phase,
      now: at,
      status: "active",
    });
    await writeAtomic(filePath, next);
    checkpoints = nextCheckpoints;
    confirmations = nextConfirmations;
    currentPhase = phase;
    state = next;
    return state;
  }

  async function fail(error) {
    const at = recoveryInstant(now);
    const next = recoverySnapshot({
      allocation,
      checkpoints: [
        ...checkpoints,
        { at, lastConfirmedPhase: currentPhase, phase: "failed" },
      ],
      confirmations,
      createdAt,
      currentPhase,
      failure: { at, ...sanitizedFailure(error) },
      now: at,
      resourcesRemaining: !recoveryResourcesAreCleaned(allocation),
      status: "failed",
    });
    await writeAtomic(filePath, next);
    state = next;
    return state;
  }

  async function complete() {
    if (
      confirmations.targetAuthCleaned !== true ||
      confirmations.sentinelCleaned !== true ||
      confirmations.ownedChildrenStopped !== true ||
      !recoveryResourcesAreCleaned(allocation)
    ) {
      throw new NativeHarnessError(
        "Native recovery evidence success conditions were not confirmed.",
      );
    }
    const at = recoveryInstant(now);
    const next = recoverySnapshot({
      allocation,
      checkpoints: [...checkpoints, { at, phase: "cleaned" }],
      confirmations,
      createdAt,
      currentPhase: "cleaned",
      now: at,
      redactProof: true,
      resourcesRemaining: false,
      status: "cleaned",
    });
    await writeAtomic(filePath, next);
    state = next;
    return state;
  }

  return { checkpoint, complete, fail, path: filePath, state: () => state };
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

function requireClockGraph(lease, graph) {
  if (
    lease.employee.state !== "owned" ||
    !graph ||
    !uuidPattern.test(graph.employeeMembershipId) ||
    !uuidPattern.test(graph.entryId) ||
    !Array.isArray(graph.breakIds) ||
    graph.breakIds.length !== 2 ||
    !graph.breakIds.every((value) => uuidPattern.test(value)) ||
    !Array.isArray(graph.clockRequestIds) ||
    graph.clockRequestIds.length !== 2 ||
    !graph.clockRequestIds.every((value) => uuidPattern.test(value)) ||
    !Array.isArray(graph.breakOperationIds) ||
    graph.breakOperationIds.length !== 4 ||
    !graph.breakOperationIds.every((value) => uuidPattern.test(value))
  ) {
    throw new NativeHarnessError("Native clock graph identity is invalid.");
  }
  return graph;
}

function clockTimelineError() {
  return new NativeHarnessError("Native clock graph timeline is invalid.");
}

function finiteInstant(value) {
  if (typeof value !== "string") return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

export function validateClockGraphTimeline(
  lease,
  timeline,
  { now = () => new Date() } = {},
) {
  const leaseStart = finiteInstant(lease?.startedAt);
  const currentValue = now();
  const current =
    currentValue instanceof Date ? currentValue.getTime() : finiteInstant(currentValue);
  if (
    leaseStart === null ||
    !Number.isFinite(current) ||
    !timeline?.entry ||
    !Array.isArray(timeline.breaks) ||
    timeline.breaks.length !== 2 ||
    !timeline.breaks.every((item) => item && typeof item === "object")
  ) {
    throw clockTimelineError();
  }

  const [firstBreak, secondBreak] = timeline.breaks;
  const instants = [
    timeline.entry.startedAt,
    timeline.entry.endedAt,
    timeline.entry.createdAt,
    ...timeline.breaks.flatMap((item) => [
      item.startedAt,
      item.endedAt,
      item.createdAt,
    ]),
  ];
  const parsed = instants.map(finiteInstant);
  if (
    parsed.some(
      (instant) =>
        instant === null || instant < leaseStart || instant > Number(current),
    ) ||
    timeline.entry.createdAt !== timeline.entry.startedAt ||
    firstBreak.createdAt !== firstBreak.startedAt ||
    secondBreak.createdAt !== secondBreak.startedAt
  ) {
    throw clockTimelineError();
  }

  const entryStart = finiteInstant(timeline.entry.startedAt);
  const entryEnd = finiteInstant(timeline.entry.endedAt);
  const firstStart = finiteInstant(firstBreak.startedAt);
  const firstEnd = finiteInstant(firstBreak.endedAt);
  const secondStart = finiteInstant(secondBreak.startedAt);
  const secondEnd = finiteInstant(secondBreak.endedAt);
  if (
    entryStart === null ||
    entryEnd === null ||
    firstStart === null ||
    firstEnd === null ||
    secondStart === null ||
    secondEnd === null ||
    !(entryStart < firstStart) ||
    !(firstStart < firstEnd) ||
    !(firstEnd <= secondStart) ||
    !(secondStart < secondEnd) ||
    !(secondEnd <= entryEnd)
  ) {
    throw clockTimelineError();
  }

  return timeline;
}

export function createClockGraphTimeline(lease, { now = () => new Date() } = {}) {
  const anchor = finiteInstant(lease?.startedAt);
  if (anchor === null) throw clockTimelineError();
  const instant = (offsetMs) => new Date(anchor + offsetMs).toISOString();
  const entryStart = instant(1);
  const firstBreakStart = instant(2);
  const firstBreakEnd = instant(3);
  const secondBreakStart = instant(4);
  const secondBreakEnd = instant(5);
  const entryEnd = instant(6);
  const timeline = {
    breaks: [
      {
        createdAt: firstBreakStart,
        endedAt: firstBreakEnd,
        startedAt: firstBreakStart,
      },
      {
        createdAt: secondBreakStart,
        endedAt: secondBreakEnd,
        startedAt: secondBreakStart,
      },
    ],
    entry: {
      createdAt: entryStart,
      endedAt: entryEnd,
      startedAt: entryStart,
    },
  };
  return validateClockGraphTimeline(lease, timeline, { now });
}

export function buildClockGraphSql(lease, graph, timelineOptions) {
  const owned = requireClockGraph(lease, graph);
  const timeline = createClockGraphTimeline(lease, timelineOptions);
  const organizationId = sqlUuid(lease.organization.id);
  const employeeId = sqlUuid(lease.employee.userId);
  const membershipId = sqlUuid(owned.employeeMembershipId);
  const worksiteId = sqlUuid(lease.worksite.id);
  const entryId = sqlUuid(owned.entryId);
  const breakIds = owned.breakIds.map(sqlUuid);
  const clockRequestIds = owned.clockRequestIds.map(sqlUuid);
  const operationIds = owned.breakOperationIds.map(sqlUuid);
  const timestamp = (value) => `${sqlText(value)}::timestamptz`;
  const operation = (index, breakId) => {
    const breakTimeline = timeline.breaks[Math.floor(index / 2)];
    const isEnding = index % 2 === 1;
    const operationName = isEnding ? "end_break" : "start_break";
    const resultCode = isEnding ? "ended" : "started";
    const endedAt = isEnding ? timestamp(breakTimeline.endedAt) : "null";
    const processedAt = isEnding ? breakTimeline.endedAt : breakTimeline.startedAt;
    return `
insert into private.time_break_operations (
  request_id, organization_id, employee_membership_id, operation,
  payload_hash, result, processed_at
) values (
  ${operationIds[index]}, ${organizationId}, ${membershipId}, '${operationName}',
  pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(${employeeId}, ${membershipId}, '${operationName}')::text,
    'UTF8'
  )),
  pg_catalog.jsonb_build_object(
    'request_id', ${operationIds[index]}, 'result_code', '${resultCode}',
    'did_transition', true, 'break_id', ${breakId}, 'time_entry_id', ${entryId},
    'started_at', ${timestamp(breakTimeline.startedAt)}, 'ended_at', ${endedAt},
    'version', ${isEnding ? 2 : 1}
  ), ${timestamp(processedAt)}
);`;
  };

  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '20s';
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, created_at,
  origin, last_correction_request_id
) values (
  ${entryId}, ${organizationId}, ${membershipId}, ${worksiteId},
  ${timestamp(timeline.entry.startedAt)}, ${timestamp(timeline.entry.createdAt)},
  'clock', null
);
insert into private.time_clock_requests (
  membership_id, request_id, operation, result_code, time_entry_id,
  worksite_id, started_at, ended_at, processed_at
) select ${membershipId}, ${clockRequestIds[0]}, 'clock_in', 'started', id,
  worksite_id, started_at, null, ${timestamp(timeline.entry.startedAt)}
from public.time_entries where id = ${entryId};
insert into public.time_breaks (
  id, organization_id, employee_membership_id, worksite_id,
  time_entry_id, started_at, created_at
) values (
  ${breakIds[0]}, ${organizationId}, ${membershipId}, ${worksiteId}, ${entryId},
  ${timestamp(timeline.breaks[0].startedAt)},
  ${timestamp(timeline.breaks[0].createdAt)}
);
${operation(0, breakIds[0])}
update public.time_breaks
set ended_at = ${timestamp(timeline.breaks[0].endedAt)}
where id = ${breakIds[0]};
${operation(1, breakIds[0])}
insert into public.time_breaks (
  id, organization_id, employee_membership_id, worksite_id,
  time_entry_id, started_at, created_at
) values (
  ${breakIds[1]}, ${organizationId}, ${membershipId}, ${worksiteId}, ${entryId},
  ${timestamp(timeline.breaks[1].startedAt)},
  ${timestamp(timeline.breaks[1].createdAt)}
);
${operation(2, breakIds[1])}
update public.time_breaks
set ended_at = ${timestamp(timeline.breaks[1].endedAt)}
where id = ${breakIds[1]};
${operation(3, breakIds[1])}
update public.time_entries
set ended_at = ${timestamp(timeline.entry.endedAt)}
where id = ${entryId};
insert into private.time_clock_requests (
  membership_id, request_id, operation, result_code, time_entry_id,
  worksite_id, started_at, ended_at, processed_at
) select ${membershipId}, ${clockRequestIds[1]}, 'clock_out', 'stopped', id,
  worksite_id, started_at, ended_at, ${timestamp(timeline.entry.endedAt)}
from public.time_entries where id = ${entryId};
select pg_catalog.json_build_object(
  'status', 'clock_graph_created',
  'employee_owned', exists (
    select 1 from public.memberships
    where id = ${membershipId} and organization_id = ${organizationId}
      and user_id = ${employeeId} and role = 'employee' and status = 'active'
  ),
  'entry_count', (select pg_catalog.count(*) from public.time_entries
    where id = ${entryId}),
  'break_count', (select pg_catalog.count(*) from public.time_breaks
    where time_entry_id = ${entryId}),
  'clock_request_count', (select pg_catalog.count(*) from private.time_clock_requests
    where membership_id = ${membershipId}),
  'break_operation_count', (select pg_catalog.count(*) from private.time_break_operations
    where employee_membership_id = ${membershipId})
);
commit;`;
}

export function buildCrossTenantClockRefusalSql(
  targetLease,
  sentinelLease,
  graph,
  identity,
  requestId,
) {
  const owned = requireClockGraph(targetLease, graph);
  const cleanupSql = buildLocalAuthCleanupSql(targetLease);
  const proofStart = "do $cloxa_local_auth_fixture$";
  assert.equal(cleanupSql.split(proofStart).length, 2);
  return cleanupSql.replace(
    proofStart,
    `set local application_name = ${sqlText(
      requireApplicationName(identity.refusalApplication),
    )};
insert into private.time_break_operations (
  request_id, organization_id, employee_membership_id, operation,
  payload_hash, result, processed_at
) values (
  ${sqlUuid(requestId)}, ${sqlUuid(sentinelLease.organization.id)},
  ${sqlUuid(sentinelLease.managerMembership.id)}, 'start_break',
  pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
  pg_catalog.jsonb_build_object(
    'request_id', ${sqlUuid(requestId)}, 'result_code', 'started',
    'did_transition', true, 'break_id', null,
    'time_entry_id', ${sqlUuid(owned.entryId)}
  ), pg_catalog.clock_timestamp()
);
${proofStart}`,
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
  return `(select pg_catalog.count(*) = 5
    from (
      values
        ('private.time_break_operations'::pg_catalog.regclass, 'time_break_operation_immutable'::name),
        ('private.time_clock_requests'::pg_catalog.regclass, 'time_clock_operation_immutable'::name),
        ('public.audit_events'::pg_catalog.regclass, 'audit_events_reject_mutation'::name),
        ('public.time_breaks'::pg_catalog.regclass, 'time_break_history'::name),
        ('public.time_entries'::pg_catalog.regclass, 'time_entry_history'::name)
    ) as expected(relation_id, trigger_name)
    join pg_catalog.pg_trigger as trigger
      on trigger.tgrelid = expected.relation_id
      and trigger.tgname = expected.trigger_name
    where trigger.tgenabled = 'O' and not trigger.tgisinternal
  )`;
}

function ownedClockGraphSql(lease, graph) {
  const owned = requireClockGraph(lease, graph);
  return `(select pg_catalog.count(*) = 1 from public.time_entries
    where id = ${sqlUuid(owned.entryId)}
      and organization_id = ${sqlUuid(lease.organization.id)}
      and membership_id = ${sqlUuid(owned.employeeMembershipId)}
      and worksite_id = ${sqlUuid(lease.worksite.id)}
      and origin = 'clock' and last_correction_request_id is null)
  and (select pg_catalog.count(*) = 2 from public.time_breaks
    where id = any(array[${owned.breakIds.map(sqlUuid).join(", ")}])
      and organization_id = ${sqlUuid(lease.organization.id)}
      and employee_membership_id = ${sqlUuid(owned.employeeMembershipId)}
      and worksite_id = ${sqlUuid(lease.worksite.id)}
      and time_entry_id = ${sqlUuid(owned.entryId)} and origin = 'live')
  and (select pg_catalog.count(*) = 2 from private.time_clock_requests
    where request_id = any(array[${owned.clockRequestIds.map(sqlUuid).join(", ")}])
      and membership_id = ${sqlUuid(owned.employeeMembershipId)}
      and worksite_id = ${sqlUuid(lease.worksite.id)}
      and time_entry_id = ${sqlUuid(owned.entryId)})
  and (select pg_catalog.count(*) = 4 from private.time_break_operations
    where request_id = any(array[${owned.breakOperationIds.map(sqlUuid).join(", ")}])
      and organization_id = ${sqlUuid(lease.organization.id)}
      and employee_membership_id = ${sqlUuid(owned.employeeMembershipId)})`;
}

function buildPreservationObservationSql(targetLease, sentinelLease, graph) {
  return `select pg_catalog.json_build_object(
  'status', 'preservation_observation',
  'target_owned', ${ownedManagerSql(targetLease)},
  'target_clock_graph_owned', ${ownedClockGraphSql(targetLease, graph)},
  'sentinel_owned', ${ownedManagerSql(sentinelLease)},
  'trigger_enabled', ${triggerEnabledSql()}
);`;
}

function buildPostconditionSql(targetLease, sentinelLease, concurrentEmail, graph) {
  const owned = requireClockGraph(targetLease, graph);
  const targetUsers = `array[${[targetLease.manager.userId, targetLease.employee.userId]
    .map(sqlUuid)
    .join(", ")}]`;
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
    and not exists (select 1 from public.time_entries
      where id = ${sqlUuid(owned.entryId)})
    and not exists (select 1 from public.time_breaks
      where id = any(array[${owned.breakIds.map(sqlUuid).join(", ")}]))
    and not exists (select 1 from private.time_clock_requests
      where membership_id = ${sqlUuid(owned.employeeMembershipId)})
    and not exists (select 1 from private.time_break_operations
      where organization_id = ${sqlUuid(targetLease.organization.id)})
    and not exists (
      select 1 from private.manager_mfa_registrations
      where auth_user_id = any(${targetUsers})
    ),
  'target_auth_owned', (select pg_catalog.count(*) = 2
    from auth.users as auth_user
    where auth_user.id = any(${targetUsers})
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

export function buildTriggerRollbackSql(
  lease,
  identity,
  triggerBoundary = cleanupTriggerTransitions[3],
) {
  const cleanupSql = buildLocalAuthCleanupSql(lease);
  const start = "begin;\n";
  if (!cleanupTriggerTransitions.includes(triggerBoundary)) {
    throw new NativeHarnessError("Native trigger rollback boundary is invalid.");
  }
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
  graph,
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
      buildPostconditionSql(lease, sentinelLease, concurrentEmail, graph),
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
    value.target_clock_graph_owned !== true ||
    value.sentinel_owned !== true ||
    value.trigger_enabled !== true
  ) {
    throw new NativeHarnessError("Native rollback preservation was not proven.");
  }
}

async function provisionNativeEmployee(
  lease,
  { admin, employeeMembershipId, invitationId, signal, store },
) {
  if (
    typeof invitationId !== "string" ||
    !uuidPattern.test(invitationId) ||
    typeof employeeMembershipId !== "string" ||
    !uuidPattern.test(employeeMembershipId)
  ) {
    throw new NativeHarnessError("Native employee preallocated identity is invalid.");
  }
  await prepareLocalAuthEmployeeInvitation(lease, { store });
  markLocalAuthInvitationAttempted(lease);
  await store.createRow("invitations", {
    accepted_by: null,
    display_name: lease.employee.displayName,
    employee_code: lease.employee.code,
    expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    id: invitationId,
    intended_role: "employee",
    invited_by: lease.manager.userId,
    normalized_email: lease.employee.email,
    organization_id: lease.organization.id,
    status: "pending",
  });
  const invitation = await admin.auth.admin.inviteUserByEmail(lease.employee.email);
  if (invitation.error || !invitation.data?.user) {
    throw new NativeHarnessError("Native employee invitation was not confirmed.");
  }
  await claimLocalAuthEmployee(lease, { store });

  await store.createRow("profiles", {
    display_name: lease.employee.displayName,
    locale: "nl-BE",
    user_id: lease.employee.userId,
  });
  await store.createRow("memberships", {
    employee_code: lease.employee.code,
    id: employeeMembershipId,
    organization_id: lease.organization.id,
    role: "employee",
    status: "active",
    user_id: lease.employee.userId,
  });
  let accepted = admin
    .from("invitations")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: lease.employee.userId,
      status: "accepted",
    })
    .eq("id", invitationId)
    .select("*")
    .single();
  if (signal && typeof accepted.abortSignal === "function") {
    accepted = accepted.abortSignal(signal);
  }
  const result = await accepted;
  if (result.error || result.data?.id !== invitationId) {
    throw new NativeHarnessError("Native employee acceptance was not confirmed.");
  }
  await verifyAcceptedLocalAuthEmployee(lease, { store });
  return {
    employeeMembershipId,
    invitationId: lease.employee.invitationId,
    userId: lease.employee.userId,
  };
}

function createClockGraph(employeeMembershipId, { createId = randomUUID } = {}) {
  return {
    breakIds: [
      allocateNativeUuid(createId, "Native break ID"),
      allocateNativeUuid(createId, "Native break ID"),
    ],
    breakOperationIds: [
      allocateNativeUuid(createId, "Native break operation ID"),
      allocateNativeUuid(createId, "Native break operation ID"),
      allocateNativeUuid(createId, "Native break operation ID"),
      allocateNativeUuid(createId, "Native break operation ID"),
    ],
    clockRequestIds: [
      allocateNativeUuid(createId, "Native clock request ID"),
      allocateNativeUuid(createId, "Native clock request ID"),
    ],
    employeeMembershipId,
    entryId: allocateNativeUuid(createId, "Native time entry ID"),
  };
}

function assertManagerProvisioned(lease, label) {
  if (lease.manager.state !== "owned" || !uuidPattern.test(lease.manager.userId)) {
    throw new NativeHarnessError(`${label} manager provisioning was not confirmed.`);
  }
}

function assertEmployeeProvisioned(allocation, result) {
  const { targetLease } = allocation;
  if (
    targetLease.employee.state !== "owned" ||
    !uuidPattern.test(targetLease.employee.userId) ||
    result?.employeeMembershipId !== allocation.graph.employeeMembershipId ||
    result?.invitationId !== allocation.invitationId ||
    result?.invitationId !== targetLease.employee.invitationId ||
    result?.userId !== targetLease.employee.userId
  ) {
    throw new NativeHarnessError(
      "Native employee provisioning identities were not confirmed.",
    );
  }
}

function assertOwnedProcessesStopped(result, label) {
  if (result?.ownedProcessesStopped !== true) {
    throw new NativeHarnessError(`${label} process termination was not confirmed.`);
  }
}

export async function runNativeRecoveryPlan({
  allocation,
  evidenceOptions = {},
  printRecoveryPath = console.log,
  steps,
  triggerBoundaries = cleanupTriggerTransitions,
}) {
  const abortOwnedOperations = () => {
    try {
      steps.abortOwnedOperations();
    } catch {
      // Aborts are best effort and never widen fixture ownership.
    }
  };
  let evidence;
  try {
    evidence = await createNativeRecoveryEvidence({
      allocation,
      ...evidenceOptions,
    });
  } catch (error) {
    abortOwnedOperations();
    throw new NativeHarnessError(
      "Native recovery evidence could not be created before mutation.",
      { cause: sanitizedCause(error) },
    );
  }

  try {
    printRecoveryPath(evidence.path);
    const processConfirmations = [];

    const observerResult = await steps.observerSmoke();
    assertOwnedProcessesStopped(observerResult, "Native observer smoke check");
    processConfirmations.push(observerResult.ownedProcessesStopped);

    await steps.provisionTargetManager();
    assertManagerProvisioned(allocation.targetLease, "Target");
    await evidence.checkpoint("target_manager_provisioned");

    await steps.provisionSentinelManager();
    assertManagerProvisioned(allocation.sentinelLease, "Sentinel");
    await evidence.checkpoint("sentinel_manager_provisioned");

    const employeeResult = await steps.provisionTargetEmployee();
    assertEmployeeProvisioned(allocation, employeeResult);
    await evidence.checkpoint("target_employee_provisioned");

    const graphResult = await steps.createClockGraph();
    assertOwnedProcessesStopped(graphResult, "Native clock graph creation");
    processConfirmations.push(graphResult.ownedProcessesStopped);
    await evidence.checkpoint("clock_graph_allocated_created");

    const ownershipResult = await steps.ownershipRefusal();
    assertOwnedProcessesStopped(ownershipResult, "Native ownership refusal");
    processConfirmations.push(ownershipResult.ownedProcessesStopped);
    await evidence.checkpoint("ownership_refusal_passed");

    const crossTenantResult = await steps.crossTenantRefusal();
    assertOwnedProcessesStopped(crossTenantResult, "Native cross-tenant refusal");
    processConfirmations.push(crossTenantResult.ownedProcessesStopped);
    await evidence.checkpoint("cross_tenant_refusal_passed");

    for (const [index, triggerBoundary] of triggerBoundaries.entries()) {
      const triggerResult = await steps.triggerRollback(triggerBoundary);
      assertOwnedProcessesStopped(triggerResult, "Native trigger rollback");
      processConfirmations.push(triggerResult.ownedProcessesStopped);
      await evidence.checkpoint("trigger_boundary_rollback_passed", {
        details: { index, triggerBoundary },
      });
    }

    const interleavingResult = await steps.interleavingCleanup();
    assertOwnedProcessesStopped(interleavingResult, "Native interleaving cleanup");
    processConfirmations.push(interleavingResult.ownedProcessesStopped);
    await evidence.checkpoint("interleaving_cleanup_completed");
    if (
      allocation.targetLease.cleanup.database !== "cleaned" ||
      allocation.targetLease.manager.state !== "deleted" ||
      allocation.targetLease.employee.state !== "deleted"
    ) {
      throw new NativeHarnessError("Target fixture cleanup was not confirmed.");
    }
    await evidence.checkpoint("target_auth_cleanup_completed", {
      confirmation: { targetAuthCleaned: true },
    });

    const sentinelResult = await steps.cleanupSentinel();
    assertOwnedProcessesStopped(sentinelResult, "Native sentinel cleanup");
    processConfirmations.push(sentinelResult.ownedProcessesStopped);
    if (
      allocation.sentinelLease.cleanup.database !== "cleaned" ||
      allocation.sentinelLease.manager.state !== "deleted" ||
      allocation.sentinelLease.employee.state !== "planned" ||
      allocation.sentinelLease.employee.invitationAttempted
    ) {
      throw new NativeHarnessError("Sentinel fixture cleanup was not confirmed.");
    }
    steps.finishSentinelOperation();
    await evidence.checkpoint("sentinel_cleanup_completed", {
      confirmation: { sentinelCleaned: true },
    });

    if (!processConfirmations.every((value) => value === true)) {
      throw new NativeHarnessError(
        "Native verification owned process termination was not confirmed.",
      );
    }
    await evidence.checkpoint("owned_processes_confirmed_stopped", {
      confirmation: { ownedChildrenStopped: true },
    });
    await evidence.complete();
    return { evidencePath: evidence.path, status: "verified" };
  } catch (error) {
    abortOwnedOperations();
    await evidence.fail(error).catch(() => {});
    throw new NativeHarnessError(
      `Native cleanup verification failed safely. Fixture resources were preserved. Recovery evidence: ${evidence.path}`,
      { cause: sanitizedCause(error) },
    );
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
  const allocation = createNativeHarnessAllocation();
  const { graph, identity, sentinelLease, targetLease } = allocation;
  const targetOperation = createLocalAuthE2eOperation(targetLease, {
    timeoutMs: localAuthFixtureDeadlines.operationMs,
  });
  const sentinelOperation = createLocalAuthE2eOperation(sentinelLease, {
    timeoutMs: localAuthFixtureDeadlines.operationMs,
  });
  const createRuntime = (operation) => {
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
    return {
      admin,
      store: createSupabaseFixtureStore(admin, { signal: operation.signal }),
    };
  };
  const targetRuntime = createRuntime(targetOperation);
  const sentinelRuntime = createRuntime(sentinelOperation);
  const targetStore = targetRuntime.store;
  const sentinelStore = sentinelRuntime.store;
  const database = createLocalAuthFixtureDatabase({
    dockerEndpoint: settings.dockerEndpoint,
    dockerEnvironment: settings.dockerEnvironment,
    runSql: runOperatorSqlAsync,
    timeoutMs: localAuthFixtureDeadlines.sqlMs,
  });
  const observe = createObservedSql(settings);
  let completed = false;

  try {
    await runNativeRecoveryPlan({
      allocation,
      steps: {
        abortOwnedOperations() {
          targetOperation.abort();
          sentinelOperation.abort();
        },
        async cleanupSentinel() {
          const result = await cleanupLocalAuthE2eLease(sentinelLease, {
            database,
            signal: sentinelOperation.signal,
            store: sentinelStore,
          });
          if (result.status !== "cleaned" || result.remaining.length !== 0) {
            throw new NativeHarnessError(
              "Unrelated sentinel fixture cleanup did not complete.",
            );
          }
          return { ownedProcessesStopped: true };
        },
        async createClockGraph() {
          const result = await runOperatorSqlAsync(
            buildClockGraphSql(targetLease, graph),
            {
              dockerEndpoint: settings.dockerEndpoint,
              environment: settings.dockerEnvironment,
              signal: targetOperation.signal,
              timeoutMs: localAuthFixtureDeadlines.sqlMs,
            },
          );
          if (
            result?.status !== "clock_graph_created" ||
            result.employee_owned !== true ||
            result.entry_count !== 1 ||
            result.break_count !== 2 ||
            result.clock_request_count !== 2 ||
            result.break_operation_count !== 4
          ) {
            throw new NativeHarnessError(
              "Native clock graph creation was not confirmed.",
            );
          }
          return { ownedProcessesStopped: true };
        },
        async crossTenantRefusal() {
          await runExpectedFailureProbe({
            expectedOwnershipRefusal: true,
            expectedSqlstate: "42501",
            label: "Native cross-tenant clock-refusal probe",
            settings,
            sql: buildCrossTenantClockRefusalSql(
              targetLease,
              sentinelLease,
              graph,
              identity,
              allocation.crossTenantRefusalRequestId,
            ),
          });
          assertPreservedObservation(
            await observeWithDeadline(
              observe,
              buildPreservationObservationSql(targetLease, sentinelLease, graph),
              nativeHarnessDeadlines,
              "Native cross-tenant refusal postconditions",
            ),
          );
          return { ownedProcessesStopped: true };
        },
        finishSentinelOperation() {
          sentinelOperation.finish();
        },
        async interleavingCleanup() {
          const result = await runNativeInterleavingScenario({
            finalizeLease: ({ signal }) =>
              cleanupLocalAuthE2eLease(targetLease, {
                database,
                signal,
                store: targetStore,
              }),
            graph,
            lease: targetLease,
            observe,
            sentinelLease,
            settings,
          });
          return { ...result, ownedProcessesStopped: true };
        },
        async observerSmoke() {
          await runObserverSqlSmokeCheck({ identity, observe });
          return { ownedProcessesStopped: true };
        },
        async ownershipRefusal() {
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
              buildPreservationObservationSql(targetLease, sentinelLease, graph),
              nativeHarnessDeadlines,
              "Native ownership-refusal postconditions",
            ),
          );
          return { ownedProcessesStopped: true };
        },
        provisionSentinelManager: () =>
          provisionLocalAuthManager(sentinelLease, {
            password,
            store: sentinelStore,
          }),
        provisionTargetEmployee: () =>
          provisionNativeEmployee(targetLease, {
            admin: targetRuntime.admin,
            employeeMembershipId: graph.employeeMembershipId,
            invitationId: allocation.invitationId,
            signal: targetOperation.signal,
            store: targetStore,
          }),
        provisionTargetManager: () =>
          provisionLocalAuthManager(targetLease, {
            password,
            store: targetStore,
          }),
        async triggerRollback(triggerBoundary) {
          await runExpectedFailureProbe({
            expectedSqlstate: "22012",
            label: "Native trigger-rollback probe",
            settings,
            sql: buildTriggerRollbackSql(targetLease, identity, triggerBoundary),
          });
          assertPreservedObservation(
            await observeWithDeadline(
              observe,
              buildPreservationObservationSql(targetLease, sentinelLease, graph),
              nativeHarnessDeadlines,
              "Native trigger-rollback postconditions",
            ),
          );
          return { ownedProcessesStopped: true };
        },
      },
    });
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
