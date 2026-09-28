"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { offboardEmployee, reinstateEmployee, setEmployeePin } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { pinErrorKey } from "@/lib/kiosk/errors";
import { pinFormProblem, type PinActionResult } from "@/lib/kiosk/pin";
import { mapOffboardError, type OffboardErrorKey } from "@/lib/manage/offboarding";
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

export interface EmploymentActionResult {
  readonly ok: boolean;
  readonly errorKey?: OffboardErrorKey;
}

function revalidateEmployee(id: string): void {
  revalidatePath(`/manage/medewerker/${id}`);
  revalidatePath("/manage/team");
}

/**
 * "Uit dienst": last day today, membership suspended, signed out everywhere,
 * deactivated. The database decides who may (scope, roles, fresh MFA).
 */
export async function offboardEmployeeAction(
  employeeId: string,
): Promise<EmploymentActionResult> {
  await requireManager();
  const id = employeeIdSchema.safeParse(employeeId);
  if (!id.success) return { ok: false, errorKey: "manageEmployee.errorGeneric" };
  try {
    await offboardEmployee(await createClient(), { employeeId: id.data });
  } catch (error) {
    return { ok: false, errorKey: mapOffboardError(error) };
  }
  revalidateEmployee(id.data);
  return { ok: true };
}

/** "Terug in dienst": refused once the person has been anonymised. */
export async function reinstateEmployeeAction(
  employeeId: string,
): Promise<EmploymentActionResult> {
  await requireManager();
  const id = employeeIdSchema.safeParse(employeeId);
  if (!id.success) return { ok: false, errorKey: "manageEmployee.errorGeneric" };
  try {
    await reinstateEmployee(await createClient(), { employeeId: id.data });
  } catch (error) {
    return { ok: false, errorKey: mapOffboardError(error) };
  }
  revalidateEmployee(id.data);
  return { ok: true };
}
