import "server-only";

import { headers } from "next/headers";

import {
  authAttempt,
  authAttemptReset,
  authLinkFailure,
  type AuthAttemptInput,
  type AuthAttemptResult,
} from "@cloxa/db";

import { env } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/server";

import { ipLimiterKey, limiterHash, resolveClientIp } from "./hash";

export type AttemptResult =
  | { kind: "allowed" }
  | { kind: "blocked"; retryAfterSeconds: number }
  /** The limiter could not be reached: callers fail closed. */
  | { kind: "unavailable" };

/** Email links can also be paused for everyone (too many failures overall). */
export type LinkAttemptResult = AttemptResult | { kind: "paused" };

function errorCode(error: unknown): string {
  return (error as { code?: string }).code ?? "unknown";
}

/** The raw client IP vouched for by the configured proxy, or null. */
export async function requestClientIp(): Promise<string | null> {
  return resolveClientIp(await headers(), env.CLOXA_PROXY_MODE);
}

const hash = (purpose: Parameters<typeof limiterHash>[1], value: string) =>
  limiterHash(env.AUTH_HASH_PEPPER, purpose, value);

/** The limiter key of the client IP, or null when unknown (IP rules are skipped). */
async function ipKey(): Promise<string | null> {
  return ipLimiterKey(await requestClientIp());
}

const ipHash = (ip: string | null) => (ip === null ? null : hash("ip", ip));
/** One address from one IP: the tight request limit, so strangers only fill their own. */
const pairHash = (normalisedEmail: string, ip: string | null) =>
  ip === null ? null : hash("email_ip", `${normalisedEmail}\n${ip}`);

export const emailHash = (normalisedEmail: string) => hash("email", normalisedEmail);
/** One login flow: the email plus the random nonce in its flow cookie. */
export const flowHash = (normalisedEmail: string, nonce: string) =>
  hash("flow", `${normalisedEmail}\n${nonce}`);
export const userHash = (userId: string) => hash("user", userId);

async function check(input: AuthAttemptInput): Promise<AuthAttemptResult | null> {
  try {
    return await authAttempt(createServiceClient(), input);
  } catch (error) {
    console.error("auth_attempt_failed", input.kind, errorCode(error));
    return null;
  }
}

async function record(input: AuthAttemptInput): Promise<AttemptResult> {
  const result = await check(input);
  if (!result) return { kind: "unavailable" };
  return result.allowed
    ? { kind: "allowed" }
    : { kind: "blocked", retryAfterSeconds: result.retryAfterSeconds };
}

/** Before sending a code. The same DB work whether or not the address has an account. */
export async function recordOtpRequest(
  normalisedEmail: string,
): Promise<AttemptResult> {
  const ip = await ipKey();
  return record({
    kind: "otp_request",
    emailHash: emailHash(normalisedEmail),
    ipHash: ipHash(ip),
    pairHash: pairHash(normalisedEmail, ip),
  });
}

/** Before checking an email code: per flow, and a per-IP cap when the IP is known. */
export async function recordOtpVerify(
  normalisedEmail: string,
  nonce: string,
): Promise<AttemptResult> {
  return record({
    kind: "otp_verify",
    emailHash: emailHash(normalisedEmail),
    flowHash: flowHash(normalisedEmail, nonce),
    ipHash: ipHash(await ipKey()),
  });
}

/**
 * Before exchanging an email link (magic link, invitation, recovery). Only a
 * check: failures are recorded afterwards with `recordLinkFailure`, so people
 * who simply click their links never use up anyone's budget.
 */
export async function checkLinkVerify(): Promise<LinkAttemptResult> {
  const result = await check({ kind: "link_verify", ipHash: ipHash(await ipKey()) });
  if (!result) return { kind: "unavailable" };
  if (result.allowed) return { kind: "allowed" };
  return result.paused
    ? { kind: "paused" }
    : { kind: "blocked", retryAfterSeconds: result.retryAfterSeconds };
}

/** After an email link was refused. Never after a success. */
export async function recordLinkFailure(): Promise<void> {
  try {
    await authLinkFailure(createServiceClient(), { ipHash: ipHash(await ipKey()) });
  } catch (error) {
    console.error("auth_link_failure_failed", errorCode(error));
  }
}

/** Before checking a TOTP code; keyed on the user, never the email. */
export async function recordTotpVerify(userId: string): Promise<AttemptResult> {
  return record({ kind: "totp_verify", userHash: userHash(userId) });
}

async function reset(keyHash: string): Promise<void> {
  try {
    await authAttemptReset(createServiceClient(), { emailHash: keyHash });
  } catch (error) {
    console.error("auth_attempt_reset_failed", errorCode(error));
  }
}

/** After a successful code: clears the email's request counters (and this IP's pair). */
export async function resetEmailAttempts(normalisedEmail: string): Promise<void> {
  await reset(emailHash(normalisedEmail));
  const pair = pairHash(normalisedEmail, await ipKey());
  if (pair) await reset(pair);
}
/** After a successful TOTP check. */
export const resetUserAttempts = (userId: string) => reset(userHash(userId));

export function retryMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}
