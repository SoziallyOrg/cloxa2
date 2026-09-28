import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { z } from "zod";

/** Trimmed, lowercased, syntactically valid email; the same form the database stores. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type HashPurpose = "email" | "ip" | "flow" | "user";

/**
 * Keyed hash for the attempt limiter: lowercase hex HMAC-SHA256. The pepper
 * keeps a leaked `auth_attempts` table from being reversed by hashing a list
 * of known addresses; the purpose prefix keeps an email, an IP, a flow and a
 * user id that happen to share a string from colliding.
 */
export function limiterHash(
  pepper: string,
  purpose: HashPurpose,
  value: string,
): string {
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

// Client IP ----------------------------------------------------------------------------------

/**
 * How the app is reached, from `CLOXA_PROXY_MODE`:
 * - `vercel` (default): the platform sets `x-real-ip`; else the first
 *   `x-forwarded-for` hop.
 * - `append:<n>`: a proxy chain that appends to `x-forwarded-for`; the client is
 *   the n-th hop from the right (1 = added by the proxy closest to us). Hops
 *   further left are client-controlled and never trusted.
 * - `none`: no proxy in front, so no header is trustworthy: every request shares
 *   one IP bucket and only the per-email limits bite.
 */
export type ProxyMode =
  { kind: "vercel" } | { kind: "append"; hops: number } | { kind: "none" };

export function parseProxyMode(raw: string | undefined): ProxyMode | null {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "vercel") return { kind: "vercel" };
  if (value === "none") return { kind: "none" };
  const match = /^append:([1-9]\d?)$/.exec(value);
  return match ? { kind: "append", hops: Number(match[1]) } : null;
}

function validIp(candidate: string | undefined | null): string | null {
  const ip = candidate?.trim();
  return ip && isIP(ip) !== 0 ? ip.toLowerCase() : null;
}

/** The raw client IP the configured proxy vouches for, or null. */
export function resolveClientIp(
  headers: Pick<Headers, "get">,
  mode: ProxyMode,
): string | null {
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  switch (mode.kind) {
    case "none":
      return null;
    case "vercel":
      return validIp(headers.get("x-real-ip")) ?? validIp(hops[0]);
    case "append":
      return validIp(hops[hops.length - mode.hops]);
  }
}

/** Shared bucket when the client IP is unknown (no proxy, or a missing/garbage header). */
export const UNKNOWN_IP = "unknown";

/** 8 groups of an IPv6 address, or null. Zone ids are dropped. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.split("%")[0] ?? "";
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1) becomes two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    address = `${address.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/**
 * Limiter key for an IP: IPv4 as is, IPv6 as its /64 (one subscriber usually
 * holds a whole /64, so per-address limits would be trivial to dodge).
 */
export function canonicalIp(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return UNKNOWN_IP;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // IPv4-mapped (::ffff:a.b.c.d) is really IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  return `${[g0, g1, g2, g3].map((g) => g.toString(16)).join(":")}::/64`;
}

export function ipLimiterKey(ip: string | null): string {
  return ip ? canonicalIp(ip) : UNKNOWN_IP;
}
