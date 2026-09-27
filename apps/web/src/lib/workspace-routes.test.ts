import { describe, expect, it } from "vitest";
import {
  usesWorkspaceShell,
  workspaceDestination,
  workspaceLinks,
} from "./workspace-routes";
describe("workspace presentation routes", () => {
  it("has role-specific primary tasks, no exports in primary navigation", () => {
    expect(workspaceLinks.employee.map(([, label]) => label)).toEqual([
      "Tijdklok",
      "Registraties",
      "Aanvragen",
    ]);
    expect(workspaceLinks.manager.map(([, label]) => label)).toEqual([
      "Overzicht",
      "Aanvragen",
      "Team",
      "Meer",
    ]);
    for (const role of ["employee", "manager"] as const)
      for (const [href] of workspaceLinks[role])
        expect(href.startsWith(`/${role}`)).toBe(true);
  });
  it.each([
    ["employee", "/employee", "/employee"],
    ["employee", "/employee/corrections", "/employee/registrations"],
    ["employee", "/employee/registrations", "/employee/registrations"],
    ["employee", "/employee/requests", "/employee/requests"],
    ["employee", "/employee/break-corrections", "/employee/requests"],
    ["manager", "/manager", "/manager"],
    ["manager", "/manager/break-corrections", "/manager/corrections"],
    ["manager", "/manager/team", "/manager/team"],
    ["manager", "/manager/exports", "/manager/more"],
    ["manager", "/manager/exports-v2", "/manager/more"],
  ] as const)("%s %s retains correct task", (role, path, destination) =>
    expect(workspaceDestination(role, path)).toBe(destination),
  );
  it("keeps public and MFA presentation separate, without authorizing any route", () => {
    for (const path of [
      "/",
      "/login",
      "/manager/security",
      "/manager/security/verify",
      "/manager/security/recovery",
      "/employee-other",
    ])
      expect(usesWorkspaceShell(path)).toBe(false);
    for (const path of ["/employee", "/employee/requests", "/manager/more"])
      expect(usesWorkspaceShell(path)).toBe(true);
  });
});
