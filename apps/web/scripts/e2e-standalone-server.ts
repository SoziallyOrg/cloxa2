/**
 * Runs the Next.js standalone server for e2e, so the tests exercise the same
 * server as production (Docker uses `output: "standalone"`; `next start`
 * does not support it and logs a warning if pointed at it).
 *
 * `next build` traces only the files the standalone server needs and skips
 * static assets and `public/`, so both are copied in first (per the Next
 * standalone docs) before the server starts.
 *
 * Run from `apps/web` after `next build`. Reads PORT and HOSTNAME from the
 * environment, like the real standalone server.js does.
 */
import { cpSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const STANDALONE_APP_DIR = `${APP_DIR}/.next/standalone/apps/web`;
const SERVER_ENTRY = `${STANDALONE_APP_DIR}/server.js`;

if (!existsSync(SERVER_ENTRY)) {
  console.error(
    `Standalone server not found at ${SERVER_ENTRY}; run \`next build\` first.`,
  );
  process.exit(1);
}

cpSync(`${APP_DIR}/.next/static`, `${STANDALONE_APP_DIR}/.next/static`, {
  recursive: true,
  force: true,
});
cpSync(`${APP_DIR}/public`, `${STANDALONE_APP_DIR}/public`, {
  recursive: true,
  force: true,
});

const result = spawnSync(process.execPath, [SERVER_ENTRY], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
