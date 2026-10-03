import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@cloxa/db";

import { COOKIE, cookieSecurity, isSecureContext } from "@/lib/auth/cookies";
import { decideManageAccess, IDLE_TIMEOUT_SECONDS } from "@/lib/auth/mfa";
import { mintActivity, readActivity } from "@/lib/auth/session-cookies";
import { countsAsActivity } from "@/lib/security/request-kind";
import { env } from "@/lib/env.server";

export const MFA_VERIFY_PATH = "/manage/beveiliging/controle";

/** `/manage/**` except the MFA setup and verify pages themselves. */
export function isGuardedManagePath(pathname: string): boolean {
  const inManage = pathname === "/manage" || pathname.startsWith("/manage/");
  const isSecurityPage =
    pathname === "/manage/beveiliging" || pathname.startsWith("/manage/beveiliging/");
  return inManage && !isSecurityPage;
}

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * Refreshes the Supabase session for this request and keeps the `/manage`
 * idle clock. Returns the response to send; the caller adds security headers.
 *
 * This is an early, cheap check. The server layouts and pages under
 * `/manage` make the authoritative decision with the same pure function.
 */
export async function updateSession(
  request: NextRequest,
  forwardHeaders: () => Headers,
): Promise<NextResponse> {
  const security = cookieSecurity(
    isSecureContext({
      protocol: request.nextUrl.protocol,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      production: process.env.NODE_ENV === "production",
    }),
  );
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: security,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const cookie of cookiesToSet) {
            // Forward refreshed tokens to this request too, so Server
            // Components don't try to spend the same refresh token again.
            request.cookies.set(cookie.name, cookie.value);
            pendingCookies.push(cookie);
          }
          Object.assign(pendingHeaders, headers);
        },
      },
    },
  );

  // Verifies the access token (refreshing it first when it is about to expire).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  let response: NextResponse | null = null;
  let activityToken: string | null = null;

  if (claims && isGuardedManagePath(request.nextUrl.pathname)) {
    const now = Date.now();
    const gate = decideManageAccess({
      aal: claims.aal,
      amr: claims.amr,
      // The page decides between "set up" and "verify"; here any failure means verify.
      hasVerifiedFactor: true,
      lastActivityAt: readActivity(
        request.cookies.get(COOKIE.activity)?.value,
        claims.sub,
        env.FLOW_COOKIE_SECRET,
        now,
      ),
      nowSeconds: Math.floor(now / 1000),
    });

    if (gate.kind !== "ok") {
      // Our own origin, never the request's Host header. 303, not 307: a
      // server-action POST must not be replayed against the verify page.
      response = NextResponse.redirect(
        new URL(MFA_VERIFY_PATH, env.CLOXA_SITE_URL),
        303,
      );
    } else if (countsAsActivity(request.method, request.headers)) {
      activityToken = mintActivity(claims.sub, env.FLOW_COOKIE_SECRET, now);
    }
  }

  response ??= NextResponse.next({ request: { headers: forwardHeaders() } });

  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, { ...options, ...security });
  }
  for (const [key, value] of Object.entries(pendingHeaders)) {
    response.headers.set(key, value);
  }
  if (activityToken) {
    response.cookies.set(COOKIE.activity, activityToken, {
      ...security,
      maxAge: IDLE_TIMEOUT_SECONDS,
    });
  }

  return response;
}
