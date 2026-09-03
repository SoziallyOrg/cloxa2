import "server-only";

import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseEmployeeCorrectionsView } from "@/lib/corrections/model";

export async function getEmployeeCorrectionRequests(client?: SupabaseClient<Database>) {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase.rpc("get_employee_correction_requests");

    return error ? null : parseEmployeeCorrectionsView(data);
  } catch {
    return null;
  }
}
