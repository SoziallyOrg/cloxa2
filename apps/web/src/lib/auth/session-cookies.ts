import { randomBytes } from "node:crypto";

import { z } from "zod";

import { FLOW_TTL_SECONDS, ORG_TTL_SECONDS } from "./cookies";
import { IDLE_TIMEOUT_SECONDS } from "./mfa";
import { signValue, verifyValue } from "./signed-cookie";

/**
 * Payloads of Cloxa's signed cookies. Org and activity values are bound to
 * the user id, so a cookie copied from another account (or left behind by a
 * previous user on a shared device) is ignored.
 */

const uuid = z.uuid();

const flowSchema = z.strictObject({
  e: z.string().min(3).max(254),
  n: z.string().max(512).nullable(),
  /** Random per flow: the tight code-guess limit counts per flow, not per email. */
  f: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});
export interface LoginFlow {
  email: string;
  next: string | null;
  nonce: string;
}

/** 128 random bits, base64url. */
export function newFlowNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function mintFlow(flow: LoginFlow, secret: string, now = Date.now()): string {
  return signValue(
    { e: flow.email, n: flow.next, f: flow.nonce },
    { secret, purpose: "flow", ttlSeconds: FLOW_TTL_SECONDS, now },
  );
}

export function readFlow(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): LoginFlow | null {
  const data = verifyValue(token, flowSchema, { secret, purpose: "flow", now });
  return data ? { email: data.e, next: data.n, nonce: data.f } : null;
}

const orgSchema = z.strictObject({ u: uuid, o: uuid });

export function mintOrgChoice(
  userId: string,
  organizationId: string,
  secret: string,
  now = Date.now(),
): string {
  return signValue(
    { u: userId, o: organizationId },
    { secret, purpose: "org", ttlSeconds: ORG_TTL_SECONDS, now },
  );
}

export function readOrgChoice(
  token: string | undefined,
  userId: string,
  secret: string,
  now = Date.now(),
): string | null {
  const data = verifyValue(token, orgSchema, { secret, purpose: "org", now });
  return data && data.u === userId ? data.o : null;
}

const activitySchema = z.strictObject({ u: uuid, t: z.number().int() });

export function mintActivity(userId: string, secret: string, now = Date.now()): string {
  return signValue(
    { u: userId, t: Math.floor(now / 1000) },
    { secret, purpose: "activity", ttlSeconds: IDLE_TIMEOUT_SECONDS, now },
  );
}

/** Last activity (epoch seconds) for this user, or null when missing, foreign or expired. */
export function readActivity(
  token: string | undefined,
  userId: string,
  secret: string,
  now = Date.now(),
): number | null {
  const data = verifyValue(token, activitySchema, { secret, purpose: "activity", now });
  return data && data.u === userId ? data.t : null;
}
