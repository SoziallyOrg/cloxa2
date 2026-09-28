import { generateKeyPairSync } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { applySecurityHeaders } from "./lib/security/proxy-headers";

vi.mock("server-only", () => ({}));

type Proxy = typeof import("./proxy").proxy;
let proxy: Proxy;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("CLOXA_SITE_URL", "https://cloxa.example");
  vi.stubEnv("AUTH_HASH_PEPPER", "p".repeat(32));
  vi.stubEnv("FLOW_COOKIE_SECRET", "f".repeat(32));
  // Required in production.
  vi.stubEnv("CLOXA_PROXY_MODE", "vercel");
  vi.stubEnv(
    "EXPORT_SIGNING_KEY",
    Buffer.from(
      generateKeyPairSync("ed25519").privateKey.export({
        format: "pem",
        type: "pkcs8",
      }),
    ).toString("base64"),
  );
  vi.stubEnv("EXPORT_SIGNING_KEY_ID", "test");
  ({ proxy } = await import("./proxy"));
});

function nonceFrom(csp: string): string {
  const match = /'nonce-([^']+)'/.exec(csp);
  if (!match?.[1]) throw new Error("no nonce in CSP");
  return match[1];
}

describe("proxy", () => {
  it("keeps the nonce CSP and forwards the same nonce to the app", async () => {
    const response = await proxy(new NextRequest("https://cloxa.example/login"));
    const csp = response.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // NextResponse.next({ request }) exposes forwarded request headers like this.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceFrom(csp));
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      csp,
    );
  });

  it("uses a fresh nonce per request", async () => {
    const first = await proxy(new NextRequest("https://cloxa.example/"));
    const second = await proxy(new NextRequest("https://cloxa.example/"));
    expect(nonceFrom(first.headers.get("Content-Security-Policy") ?? "")).not.toBe(
      nonceFrom(second.headers.get("Content-Security-Policy") ?? ""),
    );
  });

  it("leaves signed-out /manage requests to the server layout", async () => {
    const response = await proxy(new NextRequest("https://cloxa.example/manage"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain("'nonce-");
  });
});

describe("applySecurityHeaders", () => {
  it("adds headers to redirects without dropping their cookies", () => {
    const response = NextResponse.redirect("https://cloxa.example/login");
    response.cookies.set("sb-test-auth-token", "value", { httpOnly: true });
    response.headers.set("Content-Security-Policy", "default-src *");

    applySecurityHeaders(response, { "Content-Security-Policy": "default-src 'self'" });

    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("set-cookie")).toContain("sb-test-auth-token=value");
    expect(response.headers.get("location")).toBe("https://cloxa.example/login");
  });
});
