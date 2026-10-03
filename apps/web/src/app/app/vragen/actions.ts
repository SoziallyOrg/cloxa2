"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  requestCorrection,
  withdrawCorrection,
  type RequestCorrectionInput,
} from "@cloxa/db";

import { requireEmployeeArea } from "@/lib/auth/context";
import { mapCorrectionError, type CorrectionErrorKey } from "@/lib/clock/errors";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function withdrawCorrectionAction(formData: FormData): Promise<void> {
  await requireEmployeeArea();
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) return;

  const supabase = await createClient();
  try {
    await withdrawCorrection(supabase, { id: parsed.data });
  } catch {
    // The list re-renders from the database either way; a failed withdrawal
    // (already decided, for instance) simply leaves the row as it is.
  }
  revalidatePath("/app/vragen");
}

export interface SubmitCorrectionResult {
  ok: boolean;
  errorKey?: CorrectionErrorKey;
}

export async function submitCorrectionAction(
  input: RequestCorrectionInput,
): Promise<SubmitCorrectionResult> {
  await requireEmployeeArea();
  const supabase = await createClient();
  try {
    await requestCorrection(supabase, input);
  } catch (error) {
    return { ok: false, errorKey: mapCorrectionError(error) };
  }
  revalidatePath("/app/vragen");
  return { ok: true };
}
