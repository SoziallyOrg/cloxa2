import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { clientIp, limiterHash, normalizeEmail, UNKNOWN_IP } from "./hash";

const PEPPER = "p".repeat(32);

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jan.Peeters@Example.BE \n")).toBe(
      "jan.peeters@example.be",
    );
  });

  it("rejects non-emails and non-strings", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("jan")).toBeNull();
    expect(normalizeEmail("jan@")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@x.be`)).toBeNull();
  });
});

describe("limiterHash", () => {
  it("is lowercase hex HMAC-SHA256 with a purpose prefix", () => {
    const expected = createHmac("sha256", PEPPER)
      .update("email:jan@example.be")
      .digest("hex");
    expect(limiterHash(PEPPER, "email", "jan@example.be")).toBe(expected);
    expect(limiterHash(PEPPER, "email", "jan@example.be")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on the pepper and the purpose", () => {
    const base = limiterHash(PEPPER, "email", "x");
    expect(limiterHash("q".repeat(32), "email", "x")).not.toBe(base);
    expect(limiterHash(PEPPER, "ip", "x")).not.toBe(base);
  });

  it("gives the same hash for differently typed forms of one address", () => {
    const a = normalizeEmail(" JAN@example.be")!;
    const b = normalizeEmail("jan@EXAMPLE.be ")!;
    expect(limiterHash(PEPPER, "email", a)).toBe(limiterHash(PEPPER, "email", b));
  });
});

describe("clientIp", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
  });

  it("collapses garbage and missing headers into one bucket", () => {
    expect(clientIp(headers({ "x-forwarded-for": "not-an-ip" }))).toBe(UNKNOWN_IP);
    expect(clientIp(headers({}))).toBe(UNKNOWN_IP);
  });
});
