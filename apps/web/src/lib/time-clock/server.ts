import "server-only";

import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTimeClockView } from "@/lib/time-clock/model";

export async function getEmployeeTimeClock(client?: SupabaseClient<Database>) {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase.rpc("get_employee_time_clock");

    return error ? null : parseTimeClockView(data);
  } catch {
    return null;
  }
}
