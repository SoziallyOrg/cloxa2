import "server-only";

const loopbackOrigin =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/u;

/** This phase deliberately has no hosted execution path. */
export function assertLocalOrigin(value: string): string {
  if (!loopbackOrigin.test(value)) {
    throw new Error("Only an explicit local loopback origin is allowed.");
  }

  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Only an explicit local loopback origin is allowed.");
  }
  return url.origin;
}

export function getLocalSiteOrigin(): string {
  return assertLocalOrigin(process.env.CLOXA_SITE_URL ?? "http://localhost:3000");
}

/** Never forward credentials through redirects, even from a local endpoint. */
export const localOnlyFetch: typeof fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  assertLocalOrigin(url.origin);
  if (url.username || url.password) {
    throw new Error("Request credentials in URLs are not allowed.");
  }
  return fetch(input, { ...init, redirect: "error" });
};
