import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./headers";

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
});
