"use server";

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

function successMessage(resultCode: string) {
  const messages: Record<string, string> = {
    already_stopped: nlBE.timeClock.alreadyStopped,
    already_working: nlBE.timeClock.alreadyWorking,
    started: nlBE.timeClock.startSuccess,
    stopped: nlBE.timeClock.stopSuccess,
  };

  return messages[resultCode] ?? null;
}

export async function submitTimeClockAction(
  _previous: TimeClockActionState,
  formData: FormData,
): Promise<TimeClockActionState> {
  void _previous;
  const requestId = readText(formData, "request_id");
  const operation = readText(formData, "operation");

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
    const message = row ? successMessage(row.result_code) : null;

    if (
      error ||
      !row ||
      row.request_id !== requestId ||
      typeof row.did_transition !== "boolean" ||
      !message
    ) {
      return failureState();
    }

    revalidatePath("/employee");
    return { message, requestId, status: "success" };
  } catch {
    return failureState();
  }
}
