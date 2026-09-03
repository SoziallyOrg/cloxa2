"use server";

import { revalidatePath } from "next/cache";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";
import { isUuid } from "@/lib/corrections/model";
import type { DecisionActionState } from "@/lib/manager-corrections/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function decideCorrectionRequestAction(
  formData: FormData,
): Promise<DecisionActionState> {
  const copy = nlBE.managerCorrections;
  const fail = (message: string = copy.failure): DecisionActionState => ({
    status: "error",
    message,
  });
  const allowed = new Set([
    "request_id",
    "correction_request_id",
    "decision",
    "manager_note",
  ]);
  for (const key of formData.keys()) {
    if (!allowed.has(key) || formData.getAll(key).length !== 1) return fail();
  }
  const requestId = formData.get("request_id");
  const correctionRequestId = formData.get("correction_request_id");
  const decision = formData.get("decision");
  const note = formData.get("manager_note");
  if (
    !isUuid(requestId) ||
    !isUuid(correctionRequestId) ||
    !["approve", "reject"].includes(String(decision))
  )
    return fail();
  if (
    typeof note !== "string" ||
    [...note].length > 500 ||
    (decision === "reject" && !note.trim())
  ) {
    return { ...fail(copy.noteValidation), noteError: copy.noteValidation };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);
    if (context.state !== "authorized" || context.role !== "manager") return fail();
    const { data, error } = await supabase.rpc("decide_correction_request", {
      request_id: requestId,
      correction_request_id: correctionRequestId,
      decision: decision as "approve" | "reject",
      manager_note: note,
    });
    if (error) return fail();
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (
      !row ||
      row.request_id !== requestId ||
      row.correction_request_id !== correctionRequestId
    )
      return fail();
    if (!row.did_decide && row.time_entry_id === null) {
      if (
        row.result_code === "already_decided" &&
        ["approved", "rejected", "withdrawn"].includes(row.request_status)
      ) {
        revalidatePath("/manager/corrections");
        return fail(copy.alreadyDecided);
      }
      if (row.request_status === "pending") {
        if (row.result_code === "stale_request") return fail(copy.stale);
        if (row.result_code === "overlap") return fail(copy.overlap);
        if (row.result_code === "invalid_interval") return fail(copy.invalidInterval);
        if (row.result_code === "unavailable") return fail(copy.unavailable);
      }
      return fail();
    }
    const expected = decision === "approve" ? "approved" : "rejected";
    if (
      row.did_decide !== true ||
      row.result_code !== expected ||
      row.request_status !== expected ||
      (decision === "approve" ? !isUuid(row.time_entry_id) : row.time_entry_id !== null)
    )
      return fail();
    revalidatePath("/manager/corrections");
    revalidatePath("/employee/corrections");
    revalidatePath("/employee");
    return {
      status: "success",
      message: decision === "approve" ? copy.approved : copy.rejected,
    };
  } catch {
    return fail();
  }
}
