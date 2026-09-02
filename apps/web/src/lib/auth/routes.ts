const protectedRoutePrefixes = ["/employee", "/manager"] as const;
const defaultAuthenticatedPath = "/employee";
const localOrigin = "http://cloxa.local";

function decodeRepeatedly(value: string): string | null {
  let decoded = value;

  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);

      if (next === decoded) {
        return decoded;
      }

      decoded = next;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function isProtectedRoute(pathname: string): boolean {
  return protectedRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getSafePostAuthPath(value: string | null): string {
  if (!value) {
    return defaultAuthenticatedPath;
  }

  const candidate = decodeRepeatedly(value.trim());

  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f]/u.test(candidate)
  ) {
    return defaultAuthenticatedPath;
  }

  const parsed = new URL(candidate, localOrigin);

  if (parsed.origin !== localOrigin || !isProtectedRoute(parsed.pathname)) {
    return defaultAuthenticatedPath;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
