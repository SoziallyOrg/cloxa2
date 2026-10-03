/**
 * Where a login or email link may send someone afterwards. Only internal
 * paths under these prefixes pass; everything else falls back to `/start`,
 * so a crafted `next` can never bounce a fresh session to another site.
 */
const ALLOWED_PREFIXES = ["/app", "/manage", "/kies-organisatie", "/start"] as const;

const BASE = "http://cloxa.invalid";

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  // Protocol-relative (`//evil`), backslash tricks (`/\evil`) and control
  // characters are refused before URL parsing gets a chance to "fix" them.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  const path = url.pathname;
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? `${path}${url.search}` : null;
}

/** Email link types `/auth/confirm` accepts. Anything else is refused. */
export const CONFIRM_TYPES = ["email", "magiclink", "invite", "recovery"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function parseConfirmType(raw: unknown): ConfirmType | null {
  return typeof raw === "string" && (CONFIRM_TYPES as readonly string[]).includes(raw)
    ? (raw as ConfirmType)
    : null;
}

/** Supabase token hashes are hex; bound the length so junk never reaches the API. */
export function parseTokenHash(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(raw) ? raw : null;
}
