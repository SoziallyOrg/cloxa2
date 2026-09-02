import "server-only";

import type { Database } from "@cloxa/database";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment } from "@/lib/env/public";
import { assertLocalOrigin, localOnlyFetch } from "@/lib/auth/local-only";
import { getAuthCookieOptions } from "@/lib/supabase/cookies";

export function createSupabaseRouteClient(
  request: NextRequest,
  response: NextResponse,
) {
  const environment = getPublicEnvironment();

  return createServerClient<Database>(
    assertLocalOrigin(environment.NEXT_PUBLIC_SUPABASE_URL),
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: localOnlyFetch },
      cookieOptions: getAuthCookieOptions(),
      cookies: {
        encode: "tokens-only",
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, options, value }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headersToSet).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );
}
