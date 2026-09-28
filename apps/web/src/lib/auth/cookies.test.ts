import { describe, expect, it } from "vitest";

import { cookieSecurity, isCloxaCookie, isSecureContext } from "./cookies";

describe("isSecureContext", () => {
  it("is always secure in production, even over http", () => {
    expect(isSecureContext({ protocol: "http:", production: true })).toBe(true);
    expect(isSecureContext({ production: true })).toBe(true);
  });

  it("is secure for https requests outside production", () => {
    expect(isSecureContext({ protocol: "https:", production: false })).toBe(true);
    expect(isSecureContext({ forwardedProto: "https", production: false })).toBe(true);
    expect(isSecureContext({ forwardedProto: "HTTPS, http", production: false })).toBe(
      true,
    );
  });

  it("is not secure for plain http in development", () => {
    expect(isSecureContext({ protocol: "http:", production: false })).toBe(false);
    expect(isSecureContext({ forwardedProto: "http", production: false })).toBe(false);
    expect(isSecureContext({ production: false })).toBe(false);
  });
});

describe("cookieSecurity", () => {
  it("is httpOnly, SameSite=Lax and site-wide", () => {
    expect(cookieSecurity(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(cookieSecurity(false).secure).toBe(false);
    expect(cookieSecurity(false).httpOnly).toBe(true);
  });
});

describe("isCloxaCookie", () => {
  it("covers Cloxa and Supabase auth cookies only", () => {
    expect(isCloxaCookie("cx_flow")).toBe(true);
    expect(isCloxaCookie("sb-127-auth-token.0")).toBe(true);
    expect(isCloxaCookie("theme")).toBe(false);
  });
});
