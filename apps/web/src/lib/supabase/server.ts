import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import type { CloxaClient, Database } from "@cloxa/db";

import { cookieSecurity, isSecureContext } from "@/lib/auth/cookies";
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
