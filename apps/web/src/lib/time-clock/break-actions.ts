"use server";

import { revalidatePath } from "next/cache";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRequestId, type TimeClockActionState } from "./model";

export async function submitBreakAction(
  _previous: TimeClockActionState,
  form: FormData,
): Promise<TimeClockActionState> {
  void _previous;
  const fail = (): TimeClockActionState => ({
    status: "error",
    message: nlBE.breaks.failure,
  });
  for (const key of form.keys()) {
    // Next.js includes framework metadata in forms rendered before hydration.
    // It never becomes part of the RPC payload or operation identity.
    if (key.startsWith("$ACTION_")) continue;
    if (!["request_id", "operation"].includes(key) || form.getAll(key).length !== 1)
      return fail();
  }
  const id = form.get("request_id");
  const operation = form.get("operation");
  if (!isRequestId(id) || (operation !== "start_break" && operation !== "end_break"))
    return fail();
  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);
    if (context.state !== "authorized" || context.role !== "employee") return fail();
    const { data, error } = await supabase.rpc(operation, { request_id: id });
    if (error || !data || typeof data !== "object" || Array.isArray(data))
      return fail();
    revalidatePath("/employee");
    if (
      data.did_transition !== true ||
      data.result_code !== (operation === "start_break" ? "started" : "ended")
    )
      return fail();
    return {
      status: "success",
      message: operation === "start_break" ? nlBE.breaks.started : nlBE.breaks.ended,
      requestId: id,
    };
  } catch {
    return fail();
  }
}
