/*
 * Cloxa employee app service worker (ADR 006). Deliberately small: it only
 * keeps the /app shell (the last /app page and its static assets) so the
 * clock screen opens without a connection. Clock actions made offline are
 * queued in IndexedDB by the page itself, never here.
 *
 * Never cached: API calls, auth, server actions, RSC payloads, other pages.
 * Everything is network-first, so a connected device always gets fresh
 * pages and code; the cache is only the fallback.
 *
 * XSS persistence: a script injected into /app could register or poison this
 * worker's cache and keep running offline after the bug is fixed. Limits:
 * the worker only caches same-origin 200 responses from the network (never
 * anything a page writes), it is network-first so a connected device replaces
 * a poisoned copy on the next visit, the nonce CSP (worker-src 'self') stops
 * foreign worker scripts, and bumping CACHE drops every old cache on
 * activate. If an XSS in /app is ever found, bump CACHE as part of the fix.
 */
// Keep in sync with SHELL_CACHE in src/lib/offline/browser.ts (the login page
// clears it after sign-out).
const CACHE = "cloxa-shell-v1";
const SHELL_PATH = "/app";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isShellNavigation(request, url) {
  return request.mode === "navigate" && url.pathname === SHELL_PATH;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/branding/")
  );
}

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Only a real 200 page or asset: never a redirect to /login or an error.
    // (A navigation's redirect comes back unfollowed, as "opaqueredirect".)
    if (response.ok && !response.redirected && response.type === "basic") {
      await cache.put(cacheKey, response.clone());
    } else if (cacheKey === SHELL_PATH && response.type === "opaqueredirect") {
      // Signed out: forget the old screen.
      await cache.delete(SHELL_PATH);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isShellNavigation(request, url)) {
    event.respondWith(networkFirst(request, SHELL_PATH));
  } else if (isStaticAsset(url)) {
    event.respondWith(networkFirst(request, request));
  }
});
