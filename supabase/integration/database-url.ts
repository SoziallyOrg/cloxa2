import { execSync } from "node:child_process";

/** Local Supabase DB URL: SUPABASE_DB_URL, or whatever `supabase status` reports. */
export function databaseUrl(): string {
  const fromEnv = process.env.SUPABASE_DB_URL;
  if (fromEnv) return fromEnv;

  const output = execSync("supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(output) as { DB_URL?: unknown };
  if (typeof status.DB_URL !== "string") {
    throw new Error(
      "`supabase status` reported no DB_URL. Is the local stack running?",
    );
  }
  return status.DB_URL;
}
