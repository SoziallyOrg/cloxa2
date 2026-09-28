import type { NextRequest } from "next/server";

import { buildSecurityHeaders } from "./lib/security/headers";
import {
  applySecurityHeaders,
  forwardedRequestHeaders,
} from "./lib/security/proxy-headers";
import { updateSession } from "./lib/supabase/proxy";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env["NODE_ENV"] !== "production";
  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";

  const securityHeaders = buildSecurityHeaders({ nonce, isDev, supabaseUrl });
  const csp = securityHeaders["Content-Security-Policy"] ?? "";

  // Built lazily: a session refresh rewrites the request cookies first.
  const response = await updateSession(request, () =>
    forwardedRequestHeaders(request.headers, nonce, csp),
  );

  return applySecurityHeaders(response, securityHeaders);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
