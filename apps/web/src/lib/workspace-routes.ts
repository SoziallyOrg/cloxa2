export type WorkspaceRole = "employee" | "manager";
export const workspaceLinks = {
  employee: [
    ["/employee", "Tijdklok"],
    ["/employee/registrations", "Registraties"],
    ["/employee/requests", "Aanvragen"],
  ],
  manager: [
    ["/manager", "Overzicht"],
    ["/manager/corrections", "Aanvragen"],
    ["/manager/team", "Team"],
    ["/manager/more", "Meer"],
  ],
} as const;
export function workspaceDestination(role: WorkspaceRole, path: string) {
  if (role === "employee") {
    if (path === "/employee") return "/employee";
    if (path === "/employee/registrations" || path === "/employee/corrections")
      return "/employee/registrations";
    return "/employee/requests";
  }
  if (path === "/manager") return "/manager";
  if (path === "/manager/corrections" || path === "/manager/break-corrections")
    return "/manager/corrections";
  if (path === "/manager/team") return "/manager/team";
  return "/manager/more";
}
// Presentation only. Pages and actions keep their server guards.
export function usesWorkspaceShell(path: string) {
  return (
    path === "/employee" ||
    path.startsWith("/employee/") ||
    path === "/manager" ||
    (path.startsWith("/manager/") &&
      path !== "/manager/security" &&
      !path.startsWith("/manager/security/"))
  );
}
