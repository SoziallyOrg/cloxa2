import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
it("employee provider belongs to a real nested layout, not each page", () => {
  const layout = source("app/employee/layout.tsx");
  expect(layout).toContain('requireRole("employee")');
  expect(layout).toContain("<EmployeeClockProvider");
  expect(source("components/role-shell.tsx")).toContain("<EmployeeClockScope");
  expect(source("components/role-shell.tsx")).not.toContain("<EmployeeClockProvider");
  for (const path of [
    "app/employee/page.tsx",
    "app/employee/corrections/page.tsx",
    "app/employee/registrations/page.tsx",
    "app/employee/requests/page.tsx",
    "app/employee/break-corrections/page.tsx",
  ])
    expect(source(path)).toContain('requireRole("employee")');
});
it("does not introduce a manager layout that would trap MFA setup/verification", () => {
  expect(
    existsSync(fileURLToPath(new URL("../../app/manager/layout.tsx", import.meta.url))),
  ).toBe(false);
});
it("server page clock snapshots cannot seed persistent live controls", () => {
  const panel = source("components/time-clock-panel.tsx");
  expect(panel).toContain("useEmployeeClock()");
  expect(panel).not.toContain("submitTimeClockAction");
  expect(panel).not.toContain("useActionState");
  const provider = source("components/employee-clock-provider.tsx");
  expect(provider).not.toContain("localStorage");
  expect(provider).toContain("new WorkspaceClock");
});
