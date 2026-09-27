import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@cloxa/database";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseBreakView } from "./model";
export async function getBreakCorrections(existingClient?: SupabaseClient<Database>) {
  try {
    const client = existingClient ?? (await createSupabaseServerClient());
    const requestId = randomUUID();
    const { data, error } = await client.rpc("get_break_corrections", {
      request_id: requestId,
    });
    return error ? null : parseBreakView(data, requestId);
  } catch {
    return null;
  }
}
