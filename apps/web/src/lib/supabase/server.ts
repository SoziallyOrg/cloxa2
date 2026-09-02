import "server-only";

import type { Database } from "@cloxa/database";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnvironment } from "@/lib/env/public";
import { assertLocalOrigin, localOnlyFetch } from "@/lib/auth/local-only";
import { getAuthCookieOptions } from "@/lib/supabase/cookies";

export async function createSupabaseServerClient() {
  const environment = getPublicEnvironment();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    assertLocalOrigin(environment.NEXT_PUBLIC_SUPABASE_URL),
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: localOnlyFetch },
      cookieOptions: getAuthCookieOptions(),
      cookies: {
        encode: "tokens-only",
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, options, value }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies. The request proxy owns
            // session refresh in that context.
          }
        },
      },
    },
  );
}
