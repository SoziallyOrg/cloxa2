#!/usr/bin/env node
/**
 * Creates apps/web/.env.local for local development:
 * - the local Supabase URL and keys, read from `supabase status`
 * - fresh random server secrets
 *
 * Only for a loopback Supabase. Refuses to overwrite an existing file unless
 * --force is passed. Prints no secret values.
 *
 *   pnpm --filter @cloxa/web setup:env
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const force = process.argv.includes("--force");

if (existsSync(target) && !force) {
  console.error(
    ".env.local already exists. Nothing changed. Use --force to overwrite it.",
  );
  process.exit(1);
}

let status;
try {
  status = JSON.parse(
    execSync("pnpm exec supabase status -o json", {
      cwd: join(dirname(target), "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch {
  console.error(
    "Could not read `supabase status`. Start Docker Desktop and run `pnpm db:start` first.",
  );
  process.exit(1);
}

const apiUrl = String(status.API_URL ?? "");
const host = (() => {
  try {
    return new URL(apiUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error("Supabase is not running locally. Refusing to write .env.local.");
  process.exit(1);
}
for (const key of ["PUBLISHABLE_KEY", "SECRET_KEY"]) {
  if (!status[key]) {
    console.error(`\`supabase status\` has no ${key}.`);
    process.exit(1);
  }
}

const secret = () => randomBytes(48).toString("base64");

const lines = [
  "# Local development only. Created by scripts/setup-local-env.mjs.",
  `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${status.SECRET_KEY}`,
  "CLOXA_SITE_URL=http://localhost:3000",
  `AUTH_HASH_PEPPER=${secret()}`,
  `FLOW_COOKIE_SECRET=${secret()}`,
  "CLOXA_PROXY_MODE=none",
  "",
];

writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.log("Created apps/web/.env.local. Restart `pnpm dev` if it is running.");
