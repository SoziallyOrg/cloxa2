import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import type { TestProject } from "vitest/node";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ATTEMPTS = 3;

/**
 * Local Supabase DB URL: SUPABASE_DB_URL, or what the repo's pinned CLI
 * reports. Resolved once here: parallel `supabase status` calls (formerly one
 * per test file) sometimes fail, and a global CLI of another version may not
 * read this config at all. Retries, then throws with the CLI's own message.
 */
async function resolveDatabaseUrl(): Promise<string> {
  const fromEnv = process.env.SUPABASE_DB_URL;
  if (fromEnv) return fromEnv;

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const output = execSync("pnpm exec supabase status -o json", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const status = JSON.parse(output) as { DB_URL?: unknown };
      if (typeof status.DB_URL === "string") return status.DB_URL;
      lastError = "`supabase status` reported no DB_URL";
    } catch (error) {
      const stderr = (error as { stderr?: unknown }).stderr;
      lastError =
        typeof stderr === "string" && stderr.trim() !== ""
          ? stderr.trim()
          : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
  throw new Error(
    `db:integration cannot find the local database (is \`pnpm db:start\` running?): ${lastError}`,
  );
}

/**
 * Runs once before any test file. An unreachable database fails the whole run
 * here, loudly, instead of a file's `beforeAll` failing on its own (which
 * vitest reports as that file's tests being "skipped").
 */
export default async function setup(project: TestProject): Promise<void> {
  const url = await resolveDatabaseUrl();
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => undefined });
  try {
    await sql`select 1`;
  } catch (error) {
    throw new Error(
      `db:integration cannot connect to the local database: ${(error as Error).message}`,
    );
  } finally {
    await sql.end();
  }
  project.provide("databaseUrl", url);
}
