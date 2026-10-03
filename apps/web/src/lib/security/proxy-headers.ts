/**
 * Request headers forwarded to the app. Next.js reads the nonce from the
 * *request* CSP header to stamp it on its own inline scripts; without this,
 * 'strict-dynamic' blocks them in production.
 */
export function forwardedRequestHeaders(
  incoming: Headers,
  nonce: string,
  contentSecurityPolicy: string,
): Headers {
  const headers = new Headers(incoming);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  return headers;
}

/**
 * Stamps the central security headers on whatever response the proxy
 * produced (pass-through, redirect, refreshed session cookies), overwriting
 * anything weaker set earlier.
 */
export function applySecurityHeaders<T extends { headers: Headers }>(
  response: T,
  securityHeaders: Record<string, string>,
): T {
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
