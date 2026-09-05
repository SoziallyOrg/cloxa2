import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createRequire } from "node:module";

import {
  getLocalStackStatus,
  loadLocalEnvironment,
  LocalAuthError,
  localOnlyFetch,
  projectRoot,
  requireFictionalEmail,
  requireLocalOrigin,
  validateLocalStack,
} from "./local-auth-config.mjs";
import { validateCiStatus, validateRepositoryConfig } from "./ci-local-env.mjs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const localFixtureMarker = "cloxa-local-manager-v1";
const databaseContainer = "supabase_db_cloxa2";

function requireUuid(value, label) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalAuthError(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function parseFlags(values) {
  const parsed = new Map();

  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (typeof flag !== "string" || !flag.startsWith("--") || parsed.has(flag)) {
      throw new LocalAuthError("Recovery command contains malformed flags.");
    }

    if (flag === "--confirm-local-development") {
      parsed.set(flag, true);
      continue;
    }

    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new LocalAuthError(`Recovery flag ${flag} requires a value.`);
    }
    parsed.set(flag, value);
    index += 1;
  }

  return parsed;
}

function exactFlags(parsed, expected) {
  if (parsed.size !== expected.length || expected.some((flag) => !parsed.has(flag))) {
    throw new LocalAuthError("Recovery command flags do not match selected operation.");
  }
}

export function parseRecoveryArguments(args) {
  const [command, ...values] = args;
  if (!command || !["start", "status", "complete"].includes(command)) {
    throw new LocalAuthError(
      "Usage: local-manager-mfa-recovery.mjs start|status|complete with explicit confirmations.",
    );
  }

  const flags = parseFlags(values);
  if (flags.get("--confirm-local-development") !== true) {
    throw new LocalAuthError("Explicit local-development confirmation is required.");
  }

  const targetUserId = requireUuid(flags.get("--target-user"), "Target user");
  if (
    requireUuid(flags.get("--confirm-target"), "Target confirmation") !== targetUserId
  ) {
    throw new LocalAuthError("Target confirmation does not match selected manager.");
  }

  const common = { command, targetUserId };

  if (command === "start") {
    exactFlags(flags, [
      "--target-user",
      "--operation-id",
      "--confirm-local-development",
      "--confirm-target",
    ]);
    return {
      ...common,
      operationId: requireUuid(flags.get("--operation-id"), "Operation ID"),
    };
  }

  const caseId = requireUuid(flags.get("--case-id"), "Recovery case");
  if (requireUuid(flags.get("--confirm-case"), "Case confirmation") !== caseId) {
    throw new LocalAuthError(
      "Case confirmation does not match selected recovery case.",
    );
  }

  if (command === "status") {
    exactFlags(flags, [
      "--target-user",
      "--case-id",
      "--confirm-local-development",
      "--confirm-target",
      "--confirm-case",
    ]);
    return { ...common, caseId };
  }

  exactFlags(flags, [
    "--target-user",
    "--case-id",
    "--candidate-id",
    "--operation-id",
    "--confirm-local-development",
    "--confirm-target",
    "--confirm-case",
    "--confirm-candidate",
  ]);
  const candidateId = requireUuid(flags.get("--candidate-id"), "Candidate");
  if (
    requireUuid(flags.get("--confirm-candidate"), "Candidate confirmation") !==
    candidateId
  ) {
    throw new LocalAuthError(
      "Candidate confirmation does not match selected replacement candidate.",
    );
  }

  return {
    ...common,
    candidateId,
    caseId,
    operationId: requireUuid(flags.get("--operation-id"), "Operation ID"),
  };
}

export async function validateRecoveryEnvironment({
  environment = process.env,
  getStatus = getLocalStackStatus,
  root = projectRoot,
  runCommand = execFileSync,
} = {}) {
  const environmentFile = path.join(root, "apps", "web", ".env.local");
  const environmentStat = await lstat(environmentFile).catch(() => null);
  if (
    !environmentStat?.isFile() ||
    environmentStat.isSymbolicLink() ||
    environmentStat.nlink !== 1
  ) {
    throw new LocalAuthError(
      "Ignored local credential file must be a regular, unlinked file.",
    );
  }

  try {
    runCommand("git", ["check-ignore", "--quiet", "--", "apps/web/.env.local"], {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    throw new LocalAuthError("Local credential file must remain ignored by Git.");
  }

  const config = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
  try {
    validateRepositoryConfig(config);
  } catch {
    throw new LocalAuthError(
      "Repository Supabase configuration does not match project cloxa2 on local ports.",
    );
  }

  const hostedLink = await lstat(
    path.join(root, "supabase", ".temp", "project-ref"),
  ).catch(() => null);
  if (hostedLink) {
    throw new LocalAuthError(
      "Hosted Supabase project link detected. Local recovery is disabled.",
    );
  }

  requireLocalOrigin(environment.NEXT_PUBLIC_SUPABASE_URL);
  const status = getStatus();
  try {
    validateCiStatus(status);
  } catch {
    throw new LocalAuthError(
      "Running Supabase endpoints do not match project cloxa2 local stack.",
    );
  }
  const settings = validateLocalStack(environment, status);

  return {
    ...settings,
    managerEmail: requireFictionalEmail(environment.CLOXA_LOCAL_MANAGER_EMAIL),
  };
}

function sqlUuid(value) {
  return `'${requireUuid(value, "Database identifier")}'::uuid`;
}

export function runOperatorSql(sql, runCommand = execFileSync) {
  try {
    const output = runCommand(
      "docker",
      [
        "exec",
        "-i",
        databaseContainer,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        input: sql,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const value = JSON.parse(String(output).trim());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new LocalAuthError(
      "Local recovery database operation failed. No private database output was printed.",
    );
  }
}

export function operatorDatabase(dependencies = {}) {
  const call = dependencies.runOperatorSql ?? runOperatorSql;
  return {
    start(targetUserId, operationId) {
      return call(
        `select private.start_local_manager_mfa_recovery(${sqlUuid(targetUserId)}, ${sqlUuid(operationId)})::text;`,
      );
    },
    providerResult({
      caseId,
      expectedFactorId,
      operationId,
      removalSucceeded,
      targetUserId,
    }) {
      return call(
        `select private.record_local_manager_mfa_provider_result(${sqlUuid(targetUserId)}, ${sqlUuid(caseId)}, ${sqlUuid(operationId)}, ${sqlUuid(expectedFactorId)}, ${removalSucceeded ? "true" : "false"})::text;`,
      );
    },
    status(targetUserId, caseId) {
      return call(
        `select private.get_local_manager_mfa_recovery_status(${sqlUuid(targetUserId)}, ${sqlUuid(caseId)})::text;`,
      );
    },
    complete(targetUserId, caseId, candidateId, operationId) {
      return call(
        `select private.complete_local_manager_mfa_recovery(${sqlUuid(targetUserId)}, ${sqlUuid(caseId)}, ${sqlUuid(candidateId)}, ${sqlUuid(operationId)})::text;`,
      );
    },
  };
}

function requireResult(result, operation) {
  if (result.error || !result.data) {
    throw new LocalAuthError(`Native Auth ${operation} failed.`);
  }
  return result.data;
}

function safeProviderCode(error) {
  const value = error && typeof error === "object" ? error.code : null;
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/u.test(value)
    ? value
    : "unknown";
}

async function assertSelectedSyntheticManager(admin, targetUserId, managerEmail) {
  const data = requireResult(
    await admin.auth.admin.getUserById(targetUserId),
    "manager lookup",
  );
  const user = data.user;
  if (
    !user ||
    user.id !== targetUserId ||
    user.email?.toLowerCase() !== managerEmail ||
    user.app_metadata?.cloxa_local_fixture !== localFixtureMarker ||
    !user.email_confirmed_at
  ) {
    throw new LocalAuthError(
      "Selected target is not configured fictional local manager fixture.",
    );
  }
}

async function recordProviderFailure(database, details) {
  try {
    database.providerResult({ ...details, removalSucceeded: false });
  } catch {
    // Recovery denial was established by start. Never hide original provider failure.
  }
}

export async function executeRecoveryCommand(
  parsed,
  { admin, database = operatorDatabase() },
) {
  if (parsed.command === "status") {
    return database.status(parsed.targetUserId, parsed.caseId);
  }

  if (parsed.command === "complete") {
    const result = database.complete(
      parsed.targetUserId,
      parsed.caseId,
      parsed.candidateId,
      parsed.operationId,
    );
    if (result.status !== "completed") {
      throw new LocalAuthError("Recovery case is not completable.");
    }
    return result;
  }

  const started = database.start(parsed.targetUserId, parsed.operationId);
  const caseId = requireUuid(started.case_id, "Started recovery case");
  const expectedFactorId = requireUuid(started.factor_id, "Registered factor");

  if (started.status === "expired") {
    throw new LocalAuthError(
      "Recovery case expired. Start another case with a new operation ID.",
    );
  }

  if (
    ["awaiting_candidate", "candidate_verified", "completed"].includes(started.status)
  ) {
    return started;
  }

  const details = {
    caseId,
    expectedFactorId,
    operationId: parsed.operationId,
    targetUserId: parsed.targetUserId,
  };
  let factors;
  try {
    factors = requireResult(
      await admin.auth.admin.mfa.listFactors({ userId: parsed.targetUserId }),
      "factor inspection",
    ).factors;
  } catch (error) {
    await recordProviderFailure(database, details);
    throw error;
  }

  if (!Array.isArray(factors)) {
    await recordProviderFailure(database, details);
    throw new LocalAuthError("Native Auth factor state is malformed.");
  }

  const expected = factors.filter((factor) => factor.id === expectedFactorId);
  const unrelated = factors.filter((factor) => factor.id !== expectedFactorId);
  if (
    unrelated.length > 0 ||
    expected.length > 1 ||
    (expected.length === 1 &&
      (expected[0].factor_type !== "totp" || expected[0].status !== "verified"))
  ) {
    await recordProviderFailure(database, details);
    throw new LocalAuthError(
      "Unexpected native factor state requires explicit operator review. No unrelated factor was deleted.",
    );
  }

  if (expected.length === 1) {
    const deletion = await admin.auth.admin.mfa.deleteFactor({
      id: expectedFactorId,
      userId: parsed.targetUserId,
    });
    if (deletion.error) {
      await recordProviderFailure(database, details);
      throw new LocalAuthError(
        `Native Auth registered-factor removal failed (${safeProviderCode(deletion.error)}). Manager access remains blocked.`,
      );
    }

    const after = await admin.auth.admin.mfa.listFactors({
      userId: parsed.targetUserId,
    });
    if (
      after.error ||
      !Array.isArray(after.data?.factors) ||
      after.data.factors.length !== 0
    ) {
      await recordProviderFailure(database, details);
      throw new LocalAuthError(
        "Native Auth factor removal could not be confirmed. Manager access remains blocked.",
      );
    }
  }

  return database.providerResult({ ...details, removalSucceeded: true });
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseRecoveryArguments(args);
  loadLocalEnvironment();
  const settings = await validateRecoveryEnvironment();
  const requireFromWeb = createRequire(
    path.join(projectRoot, "apps", "web", "package.json"),
  );
  const { createClient } = requireFromWeb("@supabase/supabase-js");
  const admin = createClient(settings.supabaseUrl, settings.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: localOnlyFetch },
  });
  await assertSelectedSyntheticManager(
    admin,
    parsed.targetUserId,
    settings.managerEmail,
  );
  const result = await executeRecoveryCommand(parsed, { admin });

  console.log(
    JSON.stringify({
      candidateIds: result.candidate_ids,
      caseId: result.case_id,
      expiresAt: result.expires_at,
      generation: result.generation,
      status: result.status,
    }),
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
        : "Local manager MFA recovery failed. Credentials and Auth details were withheld.",
    );
    process.exitCode = 1;
  });
}
