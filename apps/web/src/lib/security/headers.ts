export interface BuildSecurityHeadersInput {
  /** Per-request CSP nonce, generated in `proxy.ts`. */
  nonce: string;
  isDev: boolean;
  /**
   * The Supabase project URL, added to `connect-src` so the browser client
   * can reach it. Passed in explicitly (rather than read from `process.env`
   * here) so this function stays pure and unit-testable.
   */
  supabaseUrl: string;
  /**
   * Cloudflare Turnstile is configured: allow its script and iframe. Off by
   * default, so the policy only widens where Turnstile actually runs.
   */
  turnstile?: boolean;
}

/** Origin of the Turnstile script and challenge iframe. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Pure builder for the security headers applied to every response in
 * `proxy.ts`. Centralised here (rather than per-route) so headers can't be
 * silently weakened by a single page.
 */
export function buildSecurityHeaders({
  nonce,
  isDev,
  supabaseUrl,
  turnstile = false,
}: BuildSecurityHeadersInput): Record<string, string> {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Ignored where 'strict-dynamic' is supported (the widget script is then
    // trusted through our nonced bundle); the fallback for older browsers.
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabaseUrl}`,
    // The /app service worker (public/sw.js). Without this, worker-src falls
    // back to script-src, where 'strict-dynamic' ignores 'self'.
    "worker-src 'self'",
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (!isDev) {
    headers["Strict-Transport-Security"] =
      "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}
