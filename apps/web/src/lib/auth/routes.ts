const protectedRoutePrefixes = ["/employee", "/manager"] as const;
const managerReturnPaths = new Set<string>([
  "/manager",
  "/manager/team",
  "/manager/corrections",
  "/manager/break-corrections",
  "/manager/exports",
  "/manager/exports-v2",
]);
const postAuthPaths = new Set<string>(["/employee", ...managerReturnPaths]);

export type RolePath = (typeof protectedRoutePrefixes)[number];
export type ManagerReturnPath =
  | "/manager"
  | "/manager/team"
  | "/manager/corrections"
  | "/manager/break-corrections"
  | "/manager/exports"
  | "/manager/exports-v2";
export type PostAuthPath = ManagerReturnPath | "/employee" | "/unauthorized";

export function isProtectedRoute(pathname: string): boolean {
  return protectedRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Only implemented role landing pages are valid post-auth destinations. */
export function getSafePostAuthPath(
  value: string | null | undefined,
  fallback: RolePath | "/unauthorized" = "/unauthorized",
): PostAuthPath {
  return value && postAuthPaths.has(value) ? (value as PostAuthPath) : fallback;
}

export function getSafeManagerReturnPath(
  value: string | null | undefined,
): ManagerReturnPath {
  return value && managerReturnPaths.has(value)
    ? (value as ManagerReturnPath)
    : "/manager";
}
