/**
 * Cloudflare Turnstile is on only when both keys are set (never locally or in
 * e2e). Pure, so `proxy.ts` (the CSP) and the server env agree on it.
 */
export function turnstileEnabled(keys: {
  siteKey: string | undefined;
  secretKey: string | undefined;
}): boolean {
  return Boolean(keys.siteKey?.trim() && keys.secretKey?.trim());
}
