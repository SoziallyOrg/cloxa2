import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseManagerCorrectionsView } from "@/lib/manager-corrections/model";

export async function getManagerCorrectionRequests() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_manager_correction_requests");
    return error ? null : parseManagerCorrectionsView(data);
  } catch {
    return null;
  }
}
