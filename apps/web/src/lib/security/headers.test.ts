import { describe, expect, it } from "vitest";

import { buildSecurityHeaders, TURNSTILE_ORIGIN } from "./headers";

const supabaseUrl = "https://example.supabase.co";

describe("buildSecurityHeaders", () => {
  it("includes the nonce in script-src and style-src", () => {
    const headers = buildSecurityHeaders({
      nonce: "abc123",
      isDev: false,
      supabaseUrl,
    });
    expect(headers["Content-Security-Policy"]).toContain("'nonce-abc123'");
    expect(headers["Content-Security-Policy"]).toMatch(/script-src[^;]*'nonce-abc123'/);
    expect(headers["Content-Security-Policy"]).toMatch(/style-src[^;]*'nonce-abc123'/);
  });

  it("adds unsafe-eval only in dev", () => {
    const dev = buildSecurityHeaders({ nonce: "n", isDev: true, supabaseUrl });
    const prod = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl });
    expect(dev["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(prod["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("only sets upgrade-insecure-requests and HSTS outside dev", () => {
    const dev = buildSecurityHeaders({ nonce: "n", isDev: true, supabaseUrl });
    const prod = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl });

    expect(dev["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();

    expect(prod["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(prod["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("includes the supabase URL in connect-src", () => {
    const headers = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl });
    expect(headers["Content-Security-Policy"]).toContain(
      `connect-src 'self' ${supabaseUrl}`,
    );
  });

  it("allows only same-origin workers, for the /app service worker", () => {
    const csp = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl })[
      "Content-Security-Policy"
    ];
    expect(csp).toContain("worker-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-n' 'strict-dynamic';/);
  });

  it("allows only self-hosted fonts", () => {
    const csp = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl })[
      "Content-Security-Policy"
    ];
    expect(csp).toContain("font-src 'self';");
    expect(csp).not.toMatch(/font-src[^;]*(data:|https:|\*)/);
  });

  it("sets the remaining fixed headers", () => {
    const headers = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("base-uri 'none'");
    expect(headers["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  describe("with Turnstile", () => {
    const directive = (csp: string | undefined, name: string) =>
      csp?.split("; ").find((part) => part.startsWith(`${name} `));

    it("allows challenges.cloudflare.com in script-src and frame-src only when enabled", () => {
      const on = buildSecurityHeaders({
        nonce: "n",
        isDev: false,
        supabaseUrl,
        turnstile: true,
      })["Content-Security-Policy"];
      expect(TURNSTILE_ORIGIN).toBe("https://challenges.cloudflare.com");
      expect(directive(on, "script-src")).toContain(TURNSTILE_ORIGIN);
      expect(directive(on, "script-src")).toContain("'nonce-n'");
      expect(directive(on, "frame-src")).toBe(`frame-src ${TURNSTILE_ORIGIN}`);
    });

    it("leaves the policy untouched when disabled or unset", () => {
      const off = buildSecurityHeaders({
        nonce: "n",
        isDev: false,
        supabaseUrl,
        turnstile: false,
      })["Content-Security-Policy"];
      const unset = buildSecurityHeaders({ nonce: "n", isDev: false, supabaseUrl })[
        "Content-Security-Policy"
      ];
      expect(off).toBe(unset);
      expect(off).not.toContain("cloudflare");
      expect(directive(off, "frame-src")).toBeUndefined();
    });

    it("keeps the other strict directives", () => {
      const on = buildSecurityHeaders({
        nonce: "n",
        isDev: false,
        supabaseUrl,
        turnstile: true,
      })["Content-Security-Policy"];
      expect(on).toContain("frame-ancestors 'none'");
      expect(on).toContain("default-src 'self'");
      expect(directive(on, "connect-src")).toBe(`connect-src 'self' ${supabaseUrl}`);
    });
  });
});
