import { createHmac, timingSafeEqual } from "node:crypto";

import type { z } from "zod";

/**
 * Tiny signed-value format for Cloxa's own cookies:
 * `base64url(json).base64url(hmac-sha256)`. The JSON carries a purpose and an
 * expiry, so a value minted for one cookie is useless in another and a stolen
 * value dies on time even if the browser keeps it. Signed, not encrypted:
 * only put data here the user may see.
 */

export type CookiePurpose = "flow" | "org" | "activity";

interface Envelope {
  p: CookiePurpose;
  /** Expiry, epoch seconds. */
  exp: number;
  d: unknown;
}

export interface SignOptions {
  secret: string;
  purpose: CookiePurpose;
  ttlSeconds: number;
  /** Epoch milliseconds; defaults to `Date.now()`. */
  now?: number;
}

export interface VerifyOptions {
  secret: string;
  purpose: CookiePurpose;
  now?: number;
}

const MAX_TOKEN_LENGTH = 4096;

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signValue(data: unknown, options: SignOptions): string {
  const now = options.now ?? Date.now();
  const envelope: Envelope = {
    p: options.purpose,
    exp: Math.floor(now / 1000) + options.ttlSeconds,
    d: data,
  };
  const body = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return `${body}.${mac(options.secret, body).toString("base64url")}`;
}

/** The signed data when signature, purpose and expiry all check out, else null. */
export function verifyValue<T>(
  token: string | undefined | null,
  schema: z.ZodType<T>,
  options: VerifyOptions,
): T | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  if (!body || !signature) return null;

  const expected = mac(options.secret, body);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;

  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof envelope !== "object" || envelope === null) return null;

  const { p, exp, d } = envelope as Partial<Envelope>;
  const now = options.now ?? Date.now();
  if (p !== options.purpose || typeof exp !== "number" || exp * 1000 <= now)
    return null;

  const parsed = schema.safeParse(d);
  return parsed.success ? parsed.data : null;
}
