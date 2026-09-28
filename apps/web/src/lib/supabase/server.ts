import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import type { CloxaClient, Database } from "@cloxa/db";

import { cookieSecurity, isSecureContext } from "@/lib/auth/cookies";
import { resolveClientIp } from "@/lib/auth/hash";
import { env } from "@/lib/env.server";

/** Whether cookies set for this request must carry `Secure`. */
export async function requestIsSecure(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSecureContext({
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    production: process.env.NODE_ENV === "production",
  });
}

/**
 * Passes the real client IP on to Supabase Auth, so its own per-IP rate
 * limits see the user rather than our server. Self-hosted/local GoTrue honours
 * `X-Forwarded-For`; hosted Supabase may ignore a caller-supplied value, so
 * our attempt limiter (and Turnstile in hosted environments) stays the backstop.
 */
export function clientIpHeaders(ip: string | null): Record<string, string> {
  return ip ? { "X-Forwarded-For": ip } : {};
}

async function forwardedIpHeaders(): Promise<Record<string, string>> {
  return clientIpHeaders(resolveClientIp(await headers(), env.CLOXA_PROXY_MODE));
}

/**
 * The user's own session client, for Server Components, Server Actions and
 * Route Handlers. Create one per request. Reads go through RLS as the user.
 */
export async function createClient(): Promise<CloxaClient> {
  const cookieStore = await cookies();
  const security = cookieSecurity(await requestIsSecure());

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: await forwardedIpHeaders() },
      cookieOptions: security,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              // Our flags win over the library defaults (which leave httpOnly off).
              cookieStore.set(name, value, { ...options, ...security });
            }
          } catch {
            // Server Components cannot set cookies; the proxy already refreshed
            // the session for this request, so there is nothing to lose here.
          }
        },
      },
    },
  );
}

/**
 * Secret-key client. Only for the service_role RPCs the architecture allows
 * (attempt limiter, onboarding, invitation linking), never to read or write
 * user data on a user's behalf. No session is stored.
 */
export function createServiceClient(): CloxaClient {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/**
 * Stateless publishable-key client for sending a login email outside the
 * request (inside `after()`): no cookies, no PKCE verifier, so the emailed
 * code and `token_hash` link work on any device. Takes the client IP as a
 * value because request headers are gone by then.
 */
export function createOtpSender(clientIp: string | null): CloxaClient {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: clientIpHeaders(clientIp) },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "implicit",
      },
    },
  );
}
