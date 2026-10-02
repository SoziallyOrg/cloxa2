/**
 * Which /manage pages use the full-width main column (docs/design.md,
 * "Layout"): the ones built for width, such as the timeline and the tables.
 * Forms, settings and the schedule editor keep the readable 720px column.
 */
const WIDE_PREFIXES = [
  "/manage/team",
  "/manage/vragen",
  "/manage/meer/exports",
  "/manage/meer/kiosks",
  "/manage/meer/audit",
] as const;

export function isWideManagePage(pathname: string): boolean {
  if (pathname === "/manage") return true;
  if (WIDE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // An employee's page is wide; the schedule editor under it is a form.
  return /^\/manage\/medewerker\/[^/]+\/?$/.test(pathname);
}
