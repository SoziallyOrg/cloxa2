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
  ])("classifies %s", (pathname, expected) => {
    expect(isProtectedRoute(pathname)).toBe(expected);
  });
});

describe("post-auth redirect validation", () => {
  it.each(["/employee", "/employee/history?periode=augustus", "/manager#open"])(
    "accepts protected local path %s",
    (pathname) => {
      expect(getSafePostAuthPath(pathname)).toBe(pathname);
    },
  );

  it.each([
    [null, "/employee"],
    ["https://example.com", "/employee"],
    ["//example.com", "/employee"],
    ["/%2f%2fexample.com", "/employee"],
    ["/%255c%255cexample.com", "/employee"],
    ["/login", "/employee"],
    ["javascript:alert(1)", "/employee"],
  ])("replaces unsafe value %s", (value, expected) => {
    expect(getSafePostAuthPath(value)).toBe(expected);
  });
});
