"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setEmployeePin } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { pinErrorKey } from "@/lib/kiosk/errors";
import { pinFormProblem, type PinActionResult } from "@/lib/kiosk/pin";
import { createClient } from "@/lib/supabase/server";

const employeeIdSchema = z.uuid();

/**
 * A manager sets (or resets) an employee's kiosk PIN: the only way for staff
 * without a login. The database decides who may (scope, roles, fresh MFA).
 */
export async function setEmployeePinAction(
  employeeId: string,
  input: { pin: string; confirmation: string },
): Promise<PinActionResult> {
  await requireManager();
  const id = employeeIdSchema.safeParse(employeeId);
  if (!id.success) return { ok: false, errorKey: "kiosk.pinErrorGeneric" };
  const pin = String(input.pin);
  const problem = pinFormProblem(pin, String(input.confirmation));
  if (problem) return { ok: false, errorKey: pinErrorKey(problem) };

  try {
    await setEmployeePin(await createClient(), { employeeId: id.data, pin });
  } catch (error) {
    return { ok: false, errorKey: pinErrorKey(error) };
  }
  revalidatePath(`/manage/medewerker/${id.data}`);
  return { ok: true };
}
