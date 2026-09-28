import "server-only";

import { headers } from "next/headers";

import { authAttempt, authAttemptReset } from "@cloxa/db";

import { env } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/server";

import { clientIp, limiterHash } from "./hash";

export type AttemptResult =
  | { kind: "allowed" }
  | { kind: "blocked"; retryAfterSeconds: number }
  /** The limiter could not be reached: callers fail closed. */
  | { kind: "unavailable" };

function errorCode(error: unknown): string {
  return (error as { code?: string }).code ?? "unknown";
}

/**
 * Records one OTP (or TOTP) attempt for a normalised email and the client IP
 * through `rpc_auth_attempt`. Only keyed hashes leave this server.
 */
export async function recordAttempt(
  kind: "otp_request" | "otp_verify",
  normalisedEmail: string,
): Promise<AttemptResult> {
  const emailHash = limiterHash(env.AUTH_HASH_PEPPER, "email", normalisedEmail);
  const ipHash = limiterHash(env.AUTH_HASH_PEPPER, "ip", clientIp(await headers()));

  try {
    const result = await authAttempt(createServiceClient(), {
      kind,
      emailHash,
      ipHash,
    });
    return result.allowed
      ? { kind: "allowed" }
      : { kind: "blocked", retryAfterSeconds: result.retryAfterSeconds };
  } catch (error) {
    console.error("auth_attempt_failed", errorCode(error));
    return { kind: "unavailable" };
  }
}

/** Clears the counters after a successful verification. Best effort. */
export async function resetAttempts(normalisedEmail: string): Promise<void> {
  try {
    await authAttemptReset(createServiceClient(), {
      emailHash: limiterHash(env.AUTH_HASH_PEPPER, "email", normalisedEmail),
    });
  } catch (error) {
    console.error("auth_attempt_reset_failed", errorCode(error));
  }
}

export function retryMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}
