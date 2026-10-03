/** Cloxa's own cookies. Supabase's session cookies start with `sb-`. */
export const COOKIE = {
  /** Email (and `next`) between the "send code" and "enter code" steps. */
  flow: "cx_flow",
  /** The chosen organization, for people with more than one. */
  org: "cx_org",
  /** Last activity in `/manage`, for the 30-minute idle timeout. */
  activity: "cx_act",
  /** A paired kiosk tablet's device secret (path `/kiosk`, see lib/kiosk/device-cookie). */
  kiosk: "cx_kiosk",
} as const;

export const FLOW_TTL_SECONDS = 10 * 60;
export const ORG_TTL_SECONDS = 30 * 24 * 3600;

/** Every cookie Cloxa or Supabase auth sets; logout clears them all. */
export function isCloxaCookie(name: string): boolean {
  return name.startsWith("cx_") || name.startsWith("sb-");
}

export interface SecureContextInput {
  /** `request.nextUrl.protocol`, e.g. `https:`, when known. */
  protocol?: string | null | undefined;
  /** Raw `x-forwarded-proto` header from the proxy in front of Next. */
  forwardedProto?: string | null | undefined;
  production: boolean;
}

/**
 * Secure whenever the request itself is https or we run in production. Not
 * derived from a configured site URL: a misconfigured URL must not quietly
 * drop the flag.
 */
export function isSecureContext({
  protocol,
  forwardedProto,
  production,
}: SecureContextInput): boolean {
  if (production) return true;
  if (protocol === "https:") return true;
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

export interface CookieSecurity {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
}

/** Options every auth cookie gets: no script access, not sent on cross-site POSTs. */
export function cookieSecurity(secure: boolean): CookieSecurity {
  return { httpOnly: true, sameSite: "lax", secure, path: "/" };
}
