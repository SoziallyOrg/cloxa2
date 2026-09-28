import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalIp,
  ipLimiterKey,
  limiterHash,
  normalizeEmail,
  parseProxyMode,
  proxyModeSetting,
  resolveClientIp,
  type ProxyMode,
} from "./hash";

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
    expect(limiterHash(PEPPER, "flow", "x")).not.toBe(base);
    expect(limiterHash(PEPPER, "user", "x")).not.toBe(base);
  });

  it("gives the same hash for differently typed forms of one address", () => {
    const a = normalizeEmail(" JAN@example.be")!;
    const b = normalizeEmail("jan@EXAMPLE.be ")!;
    expect(limiterHash(PEPPER, "email", a)).toBe(limiterHash(PEPPER, "email", b));
  });
});

describe("parseProxyMode", () => {
  it("parses the three modes", () => {
    expect(parseProxyMode("vercel")).toEqual({ kind: "vercel" });
    expect(parseProxyMode(" vercel ")).toEqual({ kind: "vercel" });
    expect(parseProxyMode("none")).toEqual({ kind: "none" });
    expect(parseProxyMode("append:2")).toEqual({ kind: "append", hops: 2 });
  });

  it("rejects anything else", () => {
    expect(parseProxyMode("append:0")).toBeNull();
    expect(parseProxyMode("append:")).toBeNull();
    expect(parseProxyMode("cloudflare")).toBeNull();
    expect(parseProxyMode("")).toBeNull();
  });
});

describe("proxyModeSetting (the CLOXA_PROXY_MODE env rule)", () => {
  it("has no default in production", () => {
    expect(proxyModeSetting(undefined, true)).toBeNull();
    expect(proxyModeSetting("", true)).toBeNull();
    expect(proxyModeSetting("  ", true)).toBeNull();
  });

  it("defaults to none outside production", () => {
    expect(proxyModeSetting(undefined, false)).toEqual({ kind: "none" });
    expect(proxyModeSetting("", false)).toEqual({ kind: "none" });
  });

  it("takes an explicit mode anywhere and rejects garbage", () => {
    expect(proxyModeSetting("vercel", true)).toEqual({ kind: "vercel" });
    expect(proxyModeSetting("append:1", false)).toEqual({ kind: "append", hops: 1 });
    expect(proxyModeSetting("cloudflare", true)).toBeNull();
    expect(proxyModeSetting("cloudflare", false)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);
  const vercel: ProxyMode = { kind: "vercel" };

  it("vercel: trusts only x-real-ip", () => {
    expect(
      resolveClientIp(
        headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.7" }),
        vercel,
      ),
    ).toBe("198.51.100.1");
  });

  it("vercel without x-real-ip gives null, never an x-forwarded-for hop", () => {
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), vercel),
    ).toBeNull();
    expect(
      resolveClientIp(
        headers({ "x-real-ip": "garbage", "x-forwarded-for": "203.0.113.7" }),
        vercel,
      ),
    ).toBeNull();
  });

  it("append:n takes the n-th hop from the right, ignoring spoofed hops on the left", () => {
    // The client sent "6.6.6.6"; our two proxies appended the real client and themselves.
    const spoofed = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" });
    expect(resolveClientIp(spoofed, { kind: "append", hops: 2 })).toBe("203.0.113.7");
    expect(resolveClientIp(spoofed, { kind: "append", hops: 1 })).toBe("10.0.0.2");
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), {
        kind: "append",
        hops: 2,
      }),
    ).toBeNull();
  });

  it("none trusts no header at all", () => {
    expect(
      resolveClientIp(headers({ "x-real-ip": "198.51.100.1" }), { kind: "none" }),
    ).toBeNull();
  });

  it("returns null for garbage and missing headers", () => {
    expect(resolveClientIp(headers({ "x-real-ip": "not-an-ip" }), vercel)).toBeNull();
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "not-an-ip" }), {
        kind: "append",
        hops: 1,
      }),
    ).toBeNull();
    expect(resolveClientIp(headers({}), vercel)).toBeNull();
  });

  it("keeps IPv6 addresses, lowercased", () => {
    expect(resolveClientIp(headers({ "x-real-ip": "2001:DB8::1" }), vercel)).toBe(
      "2001:db8::1",
    );
  });
});

describe("canonicalIp / ipLimiterKey", () => {
  it("keeps IPv4 as is", () => {
    expect(canonicalIp("203.0.113.7")).toBe("203.0.113.7");
  });

  it("reduces IPv6 to its /64, however it is written", () => {
    const key = "2001:db8:abcd:12::/64";
    expect(canonicalIp("2001:db8:abcd:12::1")).toBe(key);
    expect(canonicalIp("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff")).toBe(key);
    expect(canonicalIp("2001:db8:abcd:12:1:2:3:4%eth0")).toBe(key);
    expect(canonicalIp("::1")).toBe("0:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as IPv4", () => {
    expect(canonicalIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(canonicalIp("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("has no key (so no shared bucket) when the IP is unknown or unparsable", () => {
    expect(ipLimiterKey(null)).toBeNull();
    expect(canonicalIp("2001:db8::1::2")).toBeNull();
    expect(ipLimiterKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});
