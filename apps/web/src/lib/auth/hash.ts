import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { z } from "zod";

/** Trimmed, lowercased, syntactically valid email; the same form the database stores. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type HashPurpose = "email" | "ip";

/**
 * Keyed hash for the attempt limiter: lowercase hex HMAC-SHA256. The pepper
 * keeps a leaked `auth_attempts` table from being reversed by hashing a list
 * of known addresses; the purpose prefix keeps an email and an IP that happen
 * to share a string from colliding.
 */
export function limiterHash(
  pepper: string,
  purpose: HashPurpose,
  value: string,
): string {
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

/** Value used when no usable client IP header is present (local dev, misconfigured proxy). */
export const UNKNOWN_IP = "unknown";

/**
 * Client IP from the trusted proxy headers: the first hop of
 * `x-forwarded-for`, else `x-real-ip`. Anything that isn't an IP address
 * collapses to one shared bucket rather than letting a caller pick a fresh
 * limiter key per request.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();

  for (const candidate of [forwarded, real]) {
    if (candidate && isIP(candidate) !== 0) return candidate.toLowerCase();
  }
  return UNKNOWN_IP;
}
