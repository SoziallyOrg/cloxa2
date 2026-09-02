const protectedRoutePrefixes = ["/employee", "/manager"] as const;
const postAuthPaths = new Set<string>(protectedRoutePrefixes);

export type RolePath = (typeof protectedRoutePrefixes)[number];

export function isProtectedRoute(pathname: string): boolean {
  return protectedRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Only implemented role landing pages are valid post-auth destinations. */
export function getSafePostAuthPath(
  value: string | null | undefined,
  fallback: RolePath | "/unauthorized" = "/unauthorized",
): RolePath | "/unauthorized" {
  return value && postAuthPaths.has(value) ? (value as RolePath) : fallback;
}
