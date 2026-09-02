import { describe, expect, it } from "vitest";

import { getSafePostAuthPath, isProtectedRoute } from "./routes";

describe("protected routes", () => {
  it.each([
    ["/employee", true],
    ["/employee/history", true],
    ["/manager", true],
    ["/manager/approvals", true],
    ["/login", false],
    ["/managerial", false],
    ["/employees", false],
    ["/Manager", false],
    ["/", false],
  ])("classifies %s", (pathname, expected) => {
    expect(isProtectedRoute(pathname)).toBe(expected);
  });
});

describe("post-auth redirect validation", () => {
  it.each(["/employee", "/manager"])(
    "accepts implemented role landing page %s",
    (pathname) => {
      expect(getSafePostAuthPath(pathname)).toBe(pathname);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "https://example.com",
    "//example.com",
    "\\\\example.com",
    "/\\example.com",
    "/%2f%2fexample.com",
    "/%255c%255cexample.com",
    "/employee/../manager",
    "/employee/history",
    "/employee?next=https://example.com",
    "/manager#open",
    "/manager/",
    "/Manager",
    "/employee\n",
    " /employee",
    "/login",
    "/accept-invitation",
    "/reset-password",
    "javascript:alert(1)",
  ])("does not infer authorization from unsafe value %s", (value) => {
    expect(getSafePostAuthPath(value)).toBe("/unauthorized");
    expect(getSafePostAuthPath(value, "/manager")).toBe("/manager");
    expect(getSafePostAuthPath(value, "/employee")).toBe("/employee");
  });
});
