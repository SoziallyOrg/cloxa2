import "server-only";

import { headers } from "next/headers";

import { authAttempt, authAttemptReset, type AuthAttemptInput } from "@cloxa/db";

import { env } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/server";

import { ipLimiterKey, limiterHash, resolveClientIp } from "./hash";

export type AttemptResult =
  | { kind: "allowed" }
  | { kind: "blocked"; retryAfterSeconds: number }
  /** The limiter could not be reached: callers fail closed. */
  | { kind: "unavailable" };

function errorCode(error: unknown): string {
  return (error as { code?: string }).code ?? "unknown";
}

/** The raw client IP vouched for by the configured proxy, or null. */
export async function requestClientIp(): Promise<string | null> {
  return resolveClientIp(await headers(), env.CLOXA_PROXY_MODE);
}

const hash = (purpose: Parameters<typeof limiterHash>[1], value: string) =>
  limiterHash(env.AUTH_HASH_PEPPER, purpose, value);

async function ipHash(): Promise<string> {
  return hash("ip", ipLimiterKey(await requestClientIp()));
}

export const emailHash = (normalisedEmail: string) => hash("email", normalisedEmail);
/** One login flow: the email plus the random nonce in its flow cookie. */
export const flowHash = (normalisedEmail: string, nonce: string) =>
  hash("flow", `${normalisedEmail}\n${nonce}`);
export const userHash = (userId: string) => hash("user", userId);

async function record(input: AuthAttemptInput): Promise<AttemptResult> {
  try {
    const result = await authAttempt(createServiceClient(), input);
    return result.allowed
      ? { kind: "allowed" }
      : { kind: "blocked", retryAfterSeconds: result.retryAfterSeconds };
  } catch (error) {
    console.error("auth_attempt_failed", input.kind, errorCode(error));
    return { kind: "unavailable" };
  }
}

/** Before sending a code. The same DB work whether or not the address has an account. */
export async function recordOtpRequest(
  normalisedEmail: string,
): Promise<AttemptResult> {
  return record({
    kind: "otp_request",
    emailHash: emailHash(normalisedEmail),
    ipHash: await ipHash(),
  });
}

/** Before checking an email code: per flow, per email ceiling, per IP cap. */
export async function recordOtpVerify(
  normalisedEmail: string,
  nonce: string,
): Promise<AttemptResult> {
  return record({
    kind: "otp_verify",
    emailHash: emailHash(normalisedEmail),
    flowHash: flowHash(normalisedEmail, nonce),
    ipHash: await ipHash(),
  });
}

/** Before exchanging an email link (magic link, invitation, recovery). */
export async function recordLinkVerify(): Promise<AttemptResult> {
  return record({ kind: "link_verify", ipHash: await ipHash() });
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

/** After a successful code: clears the email's request and verify counters. */
export const resetEmailAttempts = (normalisedEmail: string) =>
  reset(emailHash(normalisedEmail));
/** After a successful TOTP check. */
export const resetUserAttempts = (userId: string) => reset(userHash(userId));

export function retryMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}
