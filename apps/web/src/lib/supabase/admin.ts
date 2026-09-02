import "server-only";

import type { Database } from "@cloxa/database";
import { createClient } from "@supabase/supabase-js";

import { assertLocalOrigin, localOnlyFetch } from "@/lib/auth/local-only";
import { getServerEnvironment } from "@/lib/env/server";

export function createSupabaseAdminClient() {
  const environment = getServerEnvironment();

  return createClient<Database>(
    assertLocalOrigin(environment.NEXT_PUBLIC_SUPABASE_URL),
    environment.SUPABASE_SECRET_KEY,
    {
      global: { fetch: localOnlyFetch },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
