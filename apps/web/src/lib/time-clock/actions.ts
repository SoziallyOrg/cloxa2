"use server";

import { submitBreakAction } from "./break-actions";
import { revalidatePath } from "next/cache";

import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRequestId, type TimeClockActionState } from "@/lib/time-clock/model";

type ClockOperation = "clock_in" | "clock_out";

function failureState(): TimeClockActionState {
  return { message: nlBE.timeClock.failure, status: "error" };
}

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isClockOperation(value: string): value is ClockOperation {
  return value === "clock_in" || value === "clock_out";
}

function successMessage(
  operation: ClockOperation,
  resultCode: unknown,
  didTransition: unknown,
) {
  if (operation === "clock_in") {
    if (resultCode === "started" && didTransition === true) {
      return nlBE.timeClock.startSuccess;
    }
    if (resultCode === "already_working" && didTransition === false) {
      return nlBE.timeClock.alreadyWorking;
    }
  }

  if (operation === "clock_out") {
    if (resultCode === "stopped" && didTransition === true) {
      return nlBE.timeClock.stopSuccess;
    }
    if (resultCode === "already_stopped" && didTransition === false) {
      return nlBE.timeClock.alreadyStopped;
    }
  }

  return null;
}

export async function submitTimeClockAction(
  _previous: TimeClockActionState,
  formData: FormData,
): Promise<TimeClockActionState> {
  void _previous;
  const requestId = readText(formData, "request_id");
  const operation = readText(formData, "operation");

  if (operation === "start_break" || operation === "end_break")
    return submitBreakAction(_previous, formData);

  if (!isRequestId(requestId) || !isClockOperation(operation)) {
    return failureState();
  }

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);

    if (context.state !== "authorized" || context.role !== "employee") {
      return failureState();
    }

    const { data, error } = await supabase.rpc(operation, {
      request_id: requestId,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (
      !error &&
      row?.request_id === requestId &&
      row.result_code === "open_break" &&
      row.did_transition === false
    ) {
      revalidatePath("/employee");
      return { status: "error", message: nlBE.breaks.interlock, requestId };
    }
    const message = row
      ? successMessage(operation, row.result_code, row.did_transition)
      : null;

    if (error || !row || row.request_id !== requestId || !message) {
      return failureState();
    }

    revalidatePath("/employee");
    return { message, requestId, status: "success" };
  } catch {
    return failureState();
  }
}
