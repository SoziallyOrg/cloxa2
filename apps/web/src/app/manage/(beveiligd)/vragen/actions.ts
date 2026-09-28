"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { decideCorrection, RpcError } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { mapDecideCorrectionError } from "@/lib/manage/errors";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

function redirectWithError(error: unknown): never {
  const key = mapDecideCorrectionError(error);
  redirect(`/manage/vragen?error=${encodeURIComponent(key)}` as Route);
}

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  await requireManager();
  const id = idSchema.parse(formData.get("id"));
  const supabase = await createClient();
  try {
    await decideCorrection(supabase, { id, decision: "approved" });
  } catch (error) {
    if (error instanceof RpcError) redirectWithError(error);
    throw error;
  }
  revalidatePath("/manage/vragen");
  revalidatePath("/manage");
}

export async function rejectCorrectionAction(formData: FormData): Promise<void> {
  await requireManager();
  const id = idSchema.parse(formData.get("id"));
  const noteParsed = z.string().trim().min(1).max(280).safeParse(formData.get("note"));
  if (!noteParsed.success) {
    redirect(
      `/manage/vragen?error=${encodeURIComponent("manageVragen.rejectNoteRequired")}` as Route,
    );
  }
  const supabase = await createClient();
  try {
    await decideCorrection(supabase, {
      id,
      decision: "rejected",
      note: noteParsed.data,
    });
  } catch (error) {
    if (error instanceof RpcError) redirectWithError(error);
    throw error;
  }
  revalidatePath("/manage/vragen");
  revalidatePath("/manage");
}
