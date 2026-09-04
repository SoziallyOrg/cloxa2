"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";
import {
  isUuid,
  type CorrectionActionState,
  type CorrectionField,
  type WithdrawalActionState,
} from "@/lib/corrections/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const localDateTimePattern =
  /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/u;
const occurrenceSchema = z.union([
  z.literal(""),
  z.literal("earlier"),
  z.literal("later"),
]);
const submissionSchema = z.object({
  employeeReason: z.string().trim().min(1).max(500),
  proposedEndLocal: z.string().regex(localDateTimePattern),
  proposedEndOccurrence: occurrenceSchema,
  proposedStartLocal: z.string().regex(localDateTimePattern),
  proposedStartOccurrence: occurrenceSchema,
  requestId: z.string().refine(isUuid),
  requestKind: z.union([z.literal("adjustment"), z.literal("missed_entry")]),
  targetTimeEntryId: z.string(),
});

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function normalizeBelgianWallTime(value: string) {
  const [date, time] = value.split(" ");
  const [day, month, year] = date!.split("/");
  return `${year}-${month}-${day}T${time}`;
}

function submissionFailure(
  message: string = nlBE.corrections.failure,
  fieldErrors?: Partial<Record<CorrectionField, string>>,
): CorrectionActionState {
  return fieldErrors
    ? { fieldErrors, message, status: "error" }
    : { message, status: "error" };
}

function databaseSubmissionFailure(
  message: string,
  detail?: string,
): CorrectionActionState {
  const timeFields = (text: string, occurrence = false) => {
    const fields: Partial<Record<CorrectionField, string>> = {};
    if (detail !== "proposed_end_local")
      fields[occurrence ? "proposed_start_occurrence" : "proposed_start_local"] = text;
    if (detail !== "proposed_start_local")
      fields[occurrence ? "proposed_end_occurrence" : "proposed_end_local"] = text;
    return fields;
  };
  if (message.includes("correction_invalid_reason")) {
    return submissionFailure(nlBE.corrections.validation.reason, {
      employee_reason: nlBE.corrections.validation.reason,
    });
  }
  if (message.includes("correction_nonexistent_local_time")) {
    return submissionFailure(
      nlBE.corrections.validation.nonexistentTime,
      timeFields(nlBE.corrections.validation.nonexistentTime),
    );
  }
  if (message.includes("correction_ambiguous_local_time")) {
    return submissionFailure(
      nlBE.corrections.validation.ambiguousTime,
      timeFields(nlBE.corrections.validation.ambiguousTime, true),
    );
  }
  if (message.includes("correction_interval_not_past")) {
    return submissionFailure(nlBE.corrections.validation.past);
  }
  if (message.includes("correction_invalid_interval")) {
    return submissionFailure(nlBE.corrections.validation.interval);
  }
  if (message.includes("correction_unchanged")) {
    return submissionFailure(nlBE.corrections.validation.unchanged);
  }
  if (message.includes("correction_factual_overlap")) {
    return submissionFailure(nlBE.corrections.validation.factualOverlap);
  }
  if (message.includes("correction_pending_conflict")) {
    return submissionFailure(nlBE.corrections.validation.pendingConflict);
  }
  if (message.includes("correction_invalid_target")) {
    return submissionFailure(nlBE.corrections.validation.target, {
      target_time_entry_id: nlBE.corrections.validation.target,
    });
  }
  if (
    message.includes("correction_invalid_local_time") ||
    message.includes("correction_invalid_request") ||
    message.includes("correction_request_id_reused")
  ) {
    return submissionFailure(nlBE.corrections.validation.form);
  }
  return submissionFailure();
}

export async function submitCorrectionRequestAction(
  _previous: CorrectionActionState,
  formData: FormData,
): Promise<CorrectionActionState> {
  void _previous;
  const parsed = submissionSchema.safeParse({
    employeeReason: readText(formData, "employee_reason"),
    proposedEndLocal: readText(formData, "proposed_end_local"),
    proposedEndOccurrence: readText(formData, "proposed_end_occurrence"),
    proposedStartLocal: readText(formData, "proposed_start_local"),
    proposedStartOccurrence: readText(formData, "proposed_start_occurrence"),
    requestId: readText(formData, "request_id"),
    requestKind: readText(formData, "request_kind"),
    targetTimeEntryId: readText(formData, "target_time_entry_id"),
  });

  if (!parsed.success) {
    const fieldMap: Record<string, CorrectionField> = {
      employeeReason: "employee_reason",
      proposedStartLocal: "proposed_start_local",
      proposedEndLocal: "proposed_end_local",
      proposedStartOccurrence: "proposed_start_occurrence",
      proposedEndOccurrence: "proposed_end_occurrence",
    };
    const fieldErrors: Partial<Record<CorrectionField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = fieldMap[String(issue.path[0])];
      if (field)
        fieldErrors[field] =
          field === "employee_reason"
            ? nlBE.corrections.validation.reason
            : nlBE.corrections.validation.form;
    }
    return submissionFailure(nlBE.corrections.validation.form, fieldErrors);
  }

  const input = parsed.data;
  const targetTimeEntryId = input.targetTimeEntryId || null;
  if (
    (input.requestKind === "adjustment" && !isUuid(targetTimeEntryId)) ||
    (input.requestKind === "missed_entry" && targetTimeEntryId !== null)
  ) {
    return submissionFailure(nlBE.corrections.validation.target, {
      target_time_entry_id: nlBE.corrections.validation.target,
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);
    if (context.state !== "authorized" || context.role !== "employee") {
      return submissionFailure();
    }

    const { data, error } = await supabase.rpc("submit_employee_correction_request", {
      employee_reason: input.employeeReason,
      proposed_end_local: normalizeBelgianWallTime(input.proposedEndLocal),
      proposed_end_occurrence: input.proposedEndOccurrence,
      proposed_start_local: normalizeBelgianWallTime(input.proposedStartLocal),
      proposed_start_occurrence: input.proposedStartOccurrence,
      request_id: input.requestId,
      request_kind: input.requestKind,
      target_time_entry_id: targetTimeEntryId ?? "",
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;

    if (error) {
      return databaseSubmissionFailure(error.message, error.details);
    }
    if (
      row?.request_id === input.requestId &&
      row.result_code === "break_conflict" &&
      row.did_create === false &&
      row.correction_request_id === null
    )
      return submissionFailure(nlBE.breaks.conflict);
    if (
      !row ||
      row.request_id !== input.requestId ||
      row.result_code !== "submitted" ||
      row.request_status !== "pending" ||
      row.did_create !== true ||
      !isUuid(row.correction_request_id)
    ) {
      return submissionFailure();
    }

    revalidatePath("/employee/corrections");
    return {
      message: nlBE.corrections.submissionSuccess,
      requestId: input.requestId,
      status: "success",
    };
  } catch {
    return submissionFailure();
  }
}

export async function withdrawCorrectionRequestAction(
  _previous: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  void _previous;
  const requestId = readText(formData, "request_id");
  const correctionRequestId = readText(formData, "correction_request_id");
  if (!isUuid(requestId) || !isUuid(correctionRequestId)) {
    return { message: nlBE.corrections.withdrawFailure, status: "error" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);
    if (context.state !== "authorized" || context.role !== "employee") {
      return { message: nlBE.corrections.withdrawFailure, status: "error" };
    }

    const { data, error } = await supabase.rpc("withdraw_employee_correction_request", {
      correction_request_id: correctionRequestId,
      request_id: requestId,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (
      error ||
      !row ||
      row.request_id !== requestId ||
      row.correction_request_id !== correctionRequestId ||
      row.request_status !== "withdrawn" ||
      !["withdrawn", "already_withdrawn"].includes(row.result_code) ||
      (row.result_code === "withdrawn") !== row.did_withdraw
    ) {
      return { message: nlBE.corrections.withdrawFailure, status: "error" };
    }

    revalidatePath("/employee/corrections");
    return {
      message:
        row.result_code === "withdrawn"
          ? nlBE.corrections.withdrawSuccess
          : nlBE.corrections.alreadyWithdrawn,
      requestId,
      status: "success",
    };
  } catch {
    return { message: nlBE.corrections.withdrawFailure, status: "error" };
  }
}
