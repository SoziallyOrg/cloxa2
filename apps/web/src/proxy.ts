import { NextResponse, type NextRequest } from "next/server";

import { buildSecurityHeaders } from "./lib/security/headers";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env["NODE_ENV"] !== "production";
  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";

  const securityHeaders = buildSecurityHeaders({ nonce, isDev, supabaseUrl });

  // Next.js reads the nonce from the *request* CSP header to stamp it on its own
  // inline scripts; without this, 'strict-dynamic' blocks them in production.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    securityHeaders["Content-Security-Policy"] ?? "",
  );

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
