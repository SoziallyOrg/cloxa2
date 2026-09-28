import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Shared helpers for the auth e2e specs (local Supabase stack + Mailpit only). */

const MAILPIT = "http://127.0.0.1:54324/api/v1";

interface MailpitSearch {
  messages: { ID: string }[];
}

export async function clearMailbox(
  request: APIRequestContext,
  address: string,
): Promise<void> {
  await request.delete(`${MAILPIT}/search`, { params: { query: `to:"${address}"` } });
}

/** The 6-digit code from the newest login email to `address`. */
export async function latestCode(
  request: APIRequestContext,
  address: string,
): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/search`, {
          params: { query: `to:"${address}" subject:"inlogcode"` },
        });
        const { messages } = (await search.json()) as MailpitSearch;
        const newest = messages[0];
        if (!newest) return null;
        const message = await request.get(`${MAILPIT}/message/${newest.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        code = /\b(\d{6})\b/.exec(Text)?.[1] ?? null;
        return code;
      },
      { timeout: 20_000, message: "no code email arrived in Mailpit" },
    )
    .not.toBeNull();
  return code!;
}

/** Requests a code on /login and signs in with it from Mailpit. */
export async function loginWithEmailCode(page: Page, address: string): Promise<void> {
  await clearMailbox(page.request, address);
  await page.goto("/login");
  await page.getByLabel("Je e-mailadres").fill(address);
  await page.getByRole("button", { name: "Stuur mij een code" }).click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await expect(page.getByRole("status")).toContainText(
    "Als dit adres bij ons bekend is",
  );
  await page
    .getByLabel("Code uit de e-mail")
    .fill(await latestCode(page.request, address));
  await page.getByRole("button", { name: "Inloggen" }).click();
}

// Local Supabase admin API (secret key from `supabase status`) ----------------------------

let status: Record<string, string> | null = null;

function local(key: string): string {
  status ??= JSON.parse(
    execSync("supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Record<string, string>;
  const value = status[key];
  if (!value) throw new Error(`supabase status has no ${key}`);
  return value;
}

async function admin(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = local("SECRET_KEY");
  const response = await fetch(`${local("API_URL")}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`admin ${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

interface AdminUser {
  id: string;
  email?: string;
}

/** Deletes every MFA factor of a seeded user, so a run always starts at enrolment. */
export async function resetFactors(address: string): Promise<void> {
  const { users } = (await admin("/users?per_page=1000")) as { users: AdminUser[] };
  const user = users.find((candidate) => candidate.email === address);
  if (!user) throw new Error(`${address} is not seeded; run dev:seed first`);
  const factors = (await admin(`/users/${user.id}/factors`)) as { id: string }[];
  for (const factor of factors) {
    await admin(`/users/${user.id}/factors/${factor.id}`, { method: "DELETE" });
  }
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) --------------------------------------------------

function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

/** Waits for the next 30-second step, so a code is never reused (TOTP replay protection). */
export async function nextTotpStep(page: Page): Promise<void> {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
}

// Console errors (CSP violations show up here as "Refused to …") ---------------------------

/**
 * Local-only noise: the production CSP carries `upgrade-insecure-requests`,
 * so over plain http://localhost Chrome upgrades a redirected client-side RSC
 * fetch to https, which fails, and Next falls back to a full navigation (which
 * works). Over https in real deployments this cannot happen. Only exactly
 * that pair of messages is ignored; any CSP violation still fails the spec.
 */
const LOCAL_HTTP_UPGRADE_NOISE = [
  /^Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR$/,
  /^Failed to fetch RSC payload for http:\/\/localhost:\d+\/\S*\. Falling back to browser navigation\./,
];

/**
 * Collects console errors and uncaught page errors for the whole test. Call
 * first, assert `toEqual([])` last: a CSP violation or hydration crash on any
 * visited page fails the spec.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const localHttp = page.url().startsWith("http://localhost:");
    if (localHttp && LOCAL_HTTP_UPGRADE_NOISE.some((noise) => noise.test(text))) return;
    errors.push(`${page.url()}: ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  return errors;
}
