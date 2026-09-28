import { describe, expect, it } from "vitest";

import { parseConfirmType, parseTokenHash, safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/uren", "/app/uren"],
    ["/manage", "/manage"],
    ["/manage/team?site=1", "/manage/team?site=1"],
    ["/kies-organisatie", "/kies-organisatie"],
    ["/start", "/start"],
  ])("allows %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "/app\u0000",
    "/app\n/evil",
    "javascript:alert(1)",
    "app",
    "/",
    "/login",
    "/auth/confirm",
    "/applicatie",
    "/manage-evil",
    "/app/../evil",
    "/%2F%2Fevil.example",
    "",
    "/app/" + "x".repeat(600),
  ])("refuses %j", (input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(["/app"])).toBeNull();
  });
});

describe("parseConfirmType", () => {
  it("accepts only the email link types", () => {
    for (const type of ["email", "magiclink", "invite", "recovery"]) {
      expect(parseConfirmType(type)).toBe(type);
    }
    for (const type of ["signup", "email_change", "sms", "", null]) {
      expect(parseConfirmType(type)).toBeNull();
    }
  });
});

describe("parseTokenHash", () => {
  it("accepts Supabase-shaped hashes and refuses the rest", () => {
    expect(parseTokenHash("a".repeat(56))).toBe("a".repeat(56));
    expect(parseTokenHash(`pkce_${"0".repeat(56)}`)).toBe(`pkce_${"0".repeat(56)}`);
    expect(parseTokenHash("short")).toBeNull();
    expect(parseTokenHash("a".repeat(40) + "<script>")).toBeNull();
    expect(parseTokenHash(undefined)).toBeNull();
  });
});
