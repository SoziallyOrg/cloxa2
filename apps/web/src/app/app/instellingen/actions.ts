"use server";

import { revalidatePath } from "next/cache";

import { setMyPin } from "@cloxa/db";

import { requireEmployeeArea } from "@/lib/auth/context";
import { pinErrorKey } from "@/lib/kiosk/errors";
import { pinFormProblem, type PinActionResult } from "@/lib/kiosk/pin";
import { createClient } from "@/lib/supabase/server";

/** The employee's own kiosk PIN (every organization they work for). */
export async function setMyPinAction(input: {
  pin: string;
  confirmation: string;
}): Promise<PinActionResult> {
  await requireEmployeeArea();
  const pin = String(input.pin);
  const problem = pinFormProblem(pin, String(input.confirmation));
  if (problem) return { ok: false, errorKey: pinErrorKey(problem) };

  try {
    await setMyPin(await createClient(), { pin });
  } catch (error) {
    return { ok: false, errorKey: pinErrorKey(error) };
  }
  revalidatePath("/app/instellingen");
  return { ok: true };
}
