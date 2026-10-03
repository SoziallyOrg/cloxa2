"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  RpcError,
  setSchedule,
  schedulePatternSchema,
  type SchedulePattern,
} from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { mapSetScheduleError } from "@/lib/manage/errors";
import { createClient } from "@/lib/supabase/server";

export interface SetScheduleActionInput {
  readonly validFrom: string;
  readonly pattern: SchedulePattern;
}

export interface SetScheduleActionResult {
  readonly ok: boolean;
  readonly errorKey?: string;
}

const validFromSchema = z.iso.date();
const employeeIdSchema = z.uuid();

/**
 * Bound with the employee id from the page (`setScheduleAction.bind(null,
 * employee.id)`), so the client form only ever sends `{ validFrom, pattern }`.
 * Re-validates the pattern with the same zod schema the RPC wrapper uses
 * (`@cloxa/db`'s `schedulePatternSchema`) before calling it, purely for a
 * friendlier error than a raw `ZodError`; the database has the last word.
 */
export async function setScheduleAction(
  employeeId: string,
  input: SetScheduleActionInput,
): Promise<SetScheduleActionResult> {
  await requireManager();
  const parsedEmployeeId = employeeIdSchema.safeParse(employeeId);
  const validFrom = validFromSchema.safeParse(input.validFrom);
  const pattern = schedulePatternSchema.safeParse(input.pattern);
  if (!parsedEmployeeId.success || !validFrom.success || !pattern.success) {
    return { ok: false, errorKey: "schedule.errorInvalidPattern" };
  }

  const supabase = await createClient();
  try {
    await setSchedule(supabase, {
      employeeId: parsedEmployeeId.data,
      validFrom: validFrom.data,
      pattern: pattern.data,
    });
  } catch (error) {
    if (error instanceof RpcError) {
      return { ok: false, errorKey: mapSetScheduleError(error) };
    }
    throw error;
  }

  revalidatePath(`/manage/medewerker/${employeeId}`);
  revalidatePath(`/manage/medewerker/${employeeId}/rooster`);
  return { ok: true };
}
