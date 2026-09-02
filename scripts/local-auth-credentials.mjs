import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import {
  getLocalStackStatus,
  LocalAuthError,
  projectRoot,
  requireFictionalEmail,
  requireLocalOrigin,
  requireLocalPassword,
  validateLocalStack,
} from "./local-auth-config.mjs";

const relativeTarget = "apps/web/.env.local";
const target = path.join(projectRoot, relativeTarget);

/** Returns additions only. Existing local values and comments are never rewritten. */
export function planLocalCredentials(source, status) {
  const names = [
    ...source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gmu),
  ].map((match) => match[1]);

  if (new Set(names).size !== names.length) {
    throw new LocalAuthError(
      "Duplicate local environment variable names are not permitted.",
    );
  }

  const current = parseEnv(source);
  validateLocalStack(current, status);
  const requested = [
    "CLOXA_SITE_URL",
    "CLOXA_LOCAL_MANAGER_EMAIL",
    "CLOXA_LOCAL_MANAGER_PASSWORD",
    "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
    "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
  ];

  for (const name of requested) {
    if (Object.hasOwn(current, name) && !current[name]?.trim()) {
      throw new LocalAuthError(
        `Existing ${name} is empty. Fill it locally or remove its blank line before generating missing values.`,
      );
    }
  }

  if (current.CLOXA_SITE_URL) requireLocalOrigin(current.CLOXA_SITE_URL, "App URL");
  if (current.CLOXA_LOCAL_MANAGER_EMAIL)
    requireFictionalEmail(current.CLOXA_LOCAL_MANAGER_EMAIL);
  for (const name of requested.filter((name) => name.endsWith("_PASSWORD"))) {
    if (current[name]) requireLocalPassword(current[name], name);
  }

  if (
    current.CLOXA_LOCAL_EMPLOYEE_PASSWORD &&
    current.CLOXA_LOCAL_EMPLOYEE_PASSWORD ===
      current.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD
  ) {
    throw new LocalAuthError("Local employee and reset passwords must differ.");
  }

  const values = {
    CLOXA_SITE_URL: "http://localhost:3000",
    CLOXA_LOCAL_MANAGER_EMAIL: "manager.local@example.test",
    CLOXA_LOCAL_MANAGER_PASSWORD: randomBytes(32).toString("base64url"),
    CLOXA_LOCAL_EMPLOYEE_PASSWORD: randomBytes(32).toString("base64url"),
    CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD: randomBytes(32).toString("base64url"),
  };
  const missing = requested.filter((name) => !Object.hasOwn(current, name));
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const prefix = source && !source.endsWith("\n") ? newline : "";

  return {
    addition: missing.length
      ? prefix +
        missing.map((name) => `${name}=${values[name]}`).join(newline) +
        newline
      : "",
    addedCount: missing.length,
  };
}

export async function createIgnoredLocalCredentials(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== "--confirm-local-development") {
    throw new LocalAuthError(
      "Usage: pnpm local:credentials --confirm-local-development. Only ignored fictional local credentials are generated.",
    );
  }

  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", relativeTarget], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new LocalAuthError(
      "Credential target must be ignored by Git before any values can be generated.",
    );
  }

  const originalStat = await lstat(target).catch(() => null);
  if (
    !originalStat?.isFile() ||
    originalStat.isSymbolicLink() ||
    originalStat.nlink !== 1
  ) {
    throw new LocalAuthError(
      "Credential target must be an existing regular, unlinked local file containing the three local Supabase variables.",
    );
  }

  const lockTarget = `${target}.cloxa-credentials.lock`;
  const lock = await open(lockTarget, "wx", 0o600).catch(() => null);
  if (!lock)
    throw new LocalAuthError(
      "Local credential generation is already locked. No file was changed.",
    );

  try {
    const source = await readFile(target, "utf8");
    const plan = planLocalCredentials(source, getLocalStackStatus());
    if (!plan.addition) return 0;

    const file = await open(target, "r+");
    try {
      const currentStat = await file.stat();
      const currentPathStat = await lstat(target);
      const unchanged =
        originalStat.ino === currentStat.ino &&
        originalStat.dev === currentStat.dev &&
        currentStat.ino === currentPathStat.ino &&
        currentStat.dev === currentPathStat.dev &&
        currentPathStat.isFile() &&
        !currentPathStat.isSymbolicLink() &&
        currentStat.nlink === 1 &&
        (await file.readFile("utf8")) === source;
      if (!unchanged)
        throw new LocalAuthError(
          "Local credential file changed during preparation. No values were appended.",
        );
      const addition = Buffer.from(plan.addition, "utf8");
      const sourceLength = Buffer.byteLength(source, "utf8");
      let written = 0;
      while (written < addition.length) {
        const result = await file.write(
          addition,
          written,
          addition.length - written,
          sourceLength + written,
        );
        if (!result.bytesWritten)
          throw new LocalAuthError(
            "Appending local credential settings failed. Inspect the ignored file before retrying.",
          );
        written += result.bytesWritten;
      }
      await file.sync();
    } finally {
      await file.close();
    }

    return plan.addedCount;
  } finally {
    await lock.close();
    // This lock was created exclusively by this invocation and contains no data.
    await unlink(lockTarget);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  createIgnoredLocalCredentials()
    .then((count) => {
      console.log(
        `Added ${count} missing local credential settings to ignored apps/web/.env.local. Existing values were preserved; no values were printed.`,
      );
    })
    .catch((error) => {
      console.error(
        error instanceof LocalAuthError
          ? error.message
          : "Local credential generation failed. No credential values were printed.",
      );
      process.exitCode = 1;
    });
}
