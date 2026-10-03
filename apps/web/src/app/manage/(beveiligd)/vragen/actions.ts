"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { decideCorrection, RpcError } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { decideReturnTo, mapDecideCorrectionError } from "@/lib/manage/errors";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

/** Back to where the decision was made (a fixed choice, never a free URL). */
function errorUrl(formData: FormData, key: string): Route {
  const base =
    decideReturnTo(formData.get("returnTo")) === "vandaag"
      ? "/manage"
      : "/manage/vragen";
  return `${base}?error=${encodeURIComponent(key)}` as Route;
}

function redirectWithError(formData: FormData, error: unknown): never {
  redirect(errorUrl(formData, mapDecideCorrectionError(error)));
}

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  await requireManager();
  const id = idSchema.parse(formData.get("id"));
  const supabase = await createClient();
  try {
    await decideCorrection(supabase, { id, decision: "approved" });
  } catch (error) {
    if (error instanceof RpcError) redirectWithError(formData, error);
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
    redirect(errorUrl(formData, "manageVragen.rejectNoteRequired"));
  }
  const supabase = await createClient();
  try {
    await decideCorrection(supabase, {
      id,
      decision: "rejected",
      note: noteParsed.data,
    });
  } catch (error) {
    if (error instanceof RpcError) redirectWithError(formData, error);
    throw error;
  }
  revalidatePath("/manage/vragen");
  revalidatePath("/manage");
}
