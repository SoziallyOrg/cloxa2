import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class LocalAuthError extends Error {}

export function loadLocalEnvironment() {
  const filename = path.join(projectRoot, "apps", "web", ".env.local");

  if (existsSync(filename)) {
    process.loadEnvFile(filename);
  }
}

/** Only literal, canonical loopback origins are eligible for privileged fixtures. */
export function requireLocalOrigin(value, label = "Supabase URL") {
  if (typeof value !== "string" || !value) {
    throw new LocalAuthError(`${label} is required.`);
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new LocalAuthError(`${label} must be a canonical local HTTP origin.`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    throw new LocalAuthError(`${label} must be a canonical local HTTP origin.`);
  }

  return url.origin;
}

export function requireLiteralLoopbackOrigin(value, label) {
  const origin = requireLocalOrigin(value, label);

  if (!["127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
    throw new LocalAuthError(`${label} must use a literal loopback address.`);
  }

  return origin;
}

export function requireFictionalEmail(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!/^[a-z0-9][a-z0-9._+-]{0,62}@example\.test$/u.test(normalized)) {
    throw new LocalAuthError(
      "Local account email must use the fictional example.test domain.",
    );
  }

  return normalized;
}

export function requireLocalPassword(value, variableName) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new LocalAuthError(`${variableName} must contain 12 to 128 characters.`);
  }

  return value;
}

export function validateBootstrapArguments(args) {
  if (args.length !== 1 || args[0] !== "--confirm-local-development") {
    throw new LocalAuthError(
      "Usage: pnpm local:bootstrap --confirm-local-development. Only fictional local accounts are permitted.",
    );
  }
}

export function getLocalStackStatus() {
  const cli = path.join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");

  try {
    const output = execFileSync(process.execPath, [cli, "status", "--output", "json"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    return JSON.parse(output);
  } catch {
    // CLI output can contain local keys. Never attach it to an exception or log it.
    throw new LocalAuthError(
      "Local Supabase is unavailable. Start Docker and pnpm supabase:start.",
    );
  }
}

export function validateLocalStack(environment, status) {
  const supabaseUrl = requireLocalOrigin(environment.NEXT_PUBLIC_SUPABASE_URL);
  const runningUrl = requireLiteralLoopbackOrigin(
    status.API_URL,
    "Running Supabase URL",
  );
  const configured = new URL(supabaseUrl);
  const running = new URL(runningUrl);

  if (configured.protocol !== running.protocol || configured.port !== running.port) {
    throw new LocalAuthError(
      "Supabase URL does not match this repository's running local stack.",
    );
  }

  const secretKey = environment.SUPABASE_SECRET_KEY;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (typeof secretKey !== "string" || !secretKey.trim()) {
    throw new LocalAuthError(
      "SUPABASE_SECRET_KEY is required in ignored local environment.",
    );
  }

  if (typeof publishableKey !== "string" || !publishableKey.trim()) {
    throw new LocalAuthError(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required in ignored local environment.",
    );
  }

  if (
    ![status.SECRET_KEY, status.SERVICE_ROLE_KEY].includes(secretKey) ||
    ![status.PUBLISHABLE_KEY, status.ANON_KEY].includes(publishableKey)
  ) {
    throw new LocalAuthError(
      "Configured keys do not match this repository's local Supabase stack.",
    );
  }

  // Use the CLI's literal loopback endpoint, avoiding any localhost DNS override.
  return { publishableKey, secretKey, supabaseUrl: runningUrl };
}

export function localOnlyFetch(input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  requireLiteralLoopbackOrigin(url.origin, "Request origin");
  return fetch(input, { ...init, redirect: "error" });
}
