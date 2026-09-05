import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  projectRoot,
  requireFictionalEmail,
  requireLiteralLoopbackOrigin,
  requireLocalPassword,
  validateLocalStack,
} from "./local-auth-config.mjs";

const relativeTarget = "apps/web/.env.local";
const expectedProjectId = "cloxa2";
const expectedPorts = Object.freeze({ api: "54321", database: "54322" });

export class CiLocalEnvError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function section(source, name) {
  const escaped = name.replaceAll(".", "\\.");
  const header = new RegExp(`^\\[${escaped}\\]\\s*$`, "mu").exec(source);
  if (!header) return undefined;
  const remainder = source.slice(header.index + header[0].length);
  const nextHeader = remainder.search(/^\s*\[/mu);
  return nextHeader === -1 ? remainder : remainder.slice(0, nextHeader);
}

function setting(source, name) {
  return source?.match(new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, "mu"))?.[1];
}

function unquote(value) {
  return value?.match(/^"([^"\\r\\n]+)"$/u)?.[1] ?? value;
}

export function validateRepositoryConfig(source) {
  if (typeof source !== "string") {
    throw new CiLocalEnvError("Repository Supabase configuration is missing.");
  }

  const firstSection = source.search(/^\s*\[/mu);
  const rootConfig = firstSection === -1 ? source : source.slice(0, firstSection);
  const projectId = unquote(setting(rootConfig, "project_id"));
  const apiPort = setting(section(source, "api"), "port");
  const databasePort = setting(section(source, "db"), "port");

  if (
    projectId !== expectedProjectId ||
    apiPort !== expectedPorts.api ||
    databasePort !== expectedPorts.database
  ) {
    throw new CiLocalEnvError(
      "Repository Supabase configuration does not match the verified local CI stack.",
    );
  }
}

function parseStatus(raw) {
  let status;

  try {
    status = JSON.parse(raw);
  } catch {
    throw new CiLocalEnvError(
      "Local Supabase returned malformed status. Credential output was withheld.",
    );
  }

  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new CiLocalEnvError(
      "Local Supabase returned malformed status. Credential output was withheld.",
    );
  }

  return status;
}

export function validateCiStatus(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new CiLocalEnvError("Local Supabase status is missing or malformed.");
  }

  let apiUrl;
  try {
    apiUrl = requireLiteralLoopbackOrigin(status.API_URL, "Running Supabase URL");
  } catch {
    throw new CiLocalEnvError(
      "Running Supabase endpoint is missing, malformed, or not literal loopback.",
    );
  }
  const api = new URL(apiUrl);

  if (api.protocol !== "http:" || api.port !== expectedPorts.api) {
    throw new CiLocalEnvError(
      "Running Supabase endpoint does not match the verified local CI stack.",
    );
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(status.DB_URL);
  } catch {
    throw new CiLocalEnvError(
      "Running Supabase database configuration is missing or malformed.",
    );
  }

  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !["127.0.0.1", "[::1]"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== expectedPorts.database
  ) {
    throw new CiLocalEnvError(
      "Running Supabase database does not match the verified local CI stack.",
    );
  }

  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  const environment = {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_SECRET_KEY: secretKey,
  };

  try {
    validateLocalStack(environment, status);
  } catch {
    throw new CiLocalEnvError(
      "Running Supabase keys are missing or do not match the verified local stack.",
    );
  }
  return { ...environment, publishableKey, secretKey };
}

export function readSupabaseStatus(runCommand = spawnSync, root = projectRoot) {
  const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
  const result = runCommand(process.execPath, [cli, "status", "--output", "json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    const exitCode =
      Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    throw new CiLocalEnvError(
      "Local Supabase status failed. Credential output was withheld.",
      exitCode,
    );
  }

  return parseStatus(result.stdout);
}

function envLine(name, value) {
  return `${name}=${JSON.stringify(value)}\n`;
}

export function planCiEnvironment(status, generateBytes = randomBytes) {
  const stack = validateCiStatus(status);
  const { publishableKey, secretKey, ...stackEnvironment } = stack;
  const values = {
    ...stackEnvironment,
    CLOXA_SITE_URL: "http://localhost:3000",
    CLOXA_LOCAL_MANAGER_EMAIL: requireFictionalEmail("manager.ci@example.test"),
    CLOXA_LOCAL_MANAGER_PASSWORD: generateBytes(32).toString("base64url"),
    CLOXA_LOCAL_EMPLOYEE_PASSWORD: generateBytes(32).toString("base64url"),
    CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD: generateBytes(32).toString("base64url"),
  };

  for (const name of [
    "CLOXA_LOCAL_MANAGER_PASSWORD",
    "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
    "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
  ]) {
    requireLocalPassword(values[name], name);
  }

  return {
    content: Object.entries(values)
      .map(([name, value]) => envLine(name, value))
      .join(""),
    secrets: [
      publishableKey,
      secretKey,
      values.CLOXA_LOCAL_MANAGER_PASSWORD,
      values.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
      values.CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD,
    ],
  };
}

export async function createCiLocalEnvironment({
  configSource,
  generateBytes,
  registerSecret = () => {},
  root = projectRoot,
  status,
}) {
  validateRepositoryConfig(configSource);
  const plan = planCiEnvironment(status, generateBytes);
  const target = path.join(root, relativeTarget);
  let file;

  try {
    file = await open(target, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new CiLocalEnvError(
        "CI environment target already exists. Refusing to overwrite it.",
      );
    }
    throw new CiLocalEnvError("CI environment file could not be created safely.");
  }

  try {
    await file.writeFile(plan.content, "utf8");
    await file.sync();
    await file.close();
    file = null;
    if (process.platform !== "win32") await chmod(target, 0o600);
    for (const secret of plan.secrets) registerSecret(secret);
  } catch {
    await file?.close().catch(() => {});
    await unlink(target).catch(() => {});
    throw new CiLocalEnvError(
      "CI environment preparation failed. Generated values were removed.",
    );
  }

  return target;
}

function escapeWorkflowCommand(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true") {
    throw new CiLocalEnvError(
      "CI environment preparation runs only inside GitHub Actions.",
    );
  }

  const configSource = await readFile(
    path.join(projectRoot, "supabase", "config.toml"),
    "utf8",
  ).catch(() => null);
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", relativeTarget], {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  if (ignored.status !== 0) {
    throw new CiLocalEnvError(
      "CI environment target is not ignored by Git. No file was created.",
    );
  }

  const status = readSupabaseStatus();
  await createCiLocalEnvironment({
    configSource,
    registerSecret: (secret) => {
      process.stdout.write(`::add-mask::${escapeWorkflowCommand(secret)}\n`);
    },
    status,
  });
  console.log(
    "Ignored local CI environment created for the verified repository stack. Values were masked and not printed.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof CiLocalEnvError
        ? error.message
        : "CI environment preparation failed. Credential output was withheld.",
    );
    process.exitCode = error instanceof CiLocalEnvError ? error.exitCode : 1;
  });
}
