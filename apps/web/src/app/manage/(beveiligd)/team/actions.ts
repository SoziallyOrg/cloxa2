"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { revokeInvitation, signOutEverywhere } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { mapInviteError } from "@/lib/manage/errors";
import { sendInvite } from "@/lib/manage/invite";
import { validateInviteForm, type InviteFormInput } from "@/lib/manage/invite-form";
import { createClient } from "@/lib/supabase/server";

export interface InviteActionResult {
  readonly ok: boolean;
  readonly errorKey?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export async function inviteMemberAction(
  input: InviteFormInput,
): Promise<InviteActionResult> {
  const context = await requireManager();
  const canInvitePrivilegedRoles =
    context.membership.role === "owner" || context.membership.role === "admin";
  const validated = validateInviteForm(input, canInvitePrivilegedRoles);
  if (!validated.ok || !validated.values) {
    return { ok: false, fieldErrors: validated.fieldErrors };
  }

  const supabase = await createClient();
  try {
    await sendInvite(supabase, {
      organizationId: context.membership.organizationId,
      email: validated.values.email,
      role: validated.values.role,
      displayName: validated.values.displayName,
      siteIds: validated.values.siteIds,
      statute: validated.values.statute,
      ...(validated.values.employeeCode
        ? { employeeCode: validated.values.employeeCode }
        : {}),
    });
  } catch (error) {
    return { ok: false, errorKey: mapInviteError(error) };
  }

  revalidatePath("/manage/team");
  return { ok: true };
}

const idSchema = z.uuid();

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  await requireManager();
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) return;
  const supabase = await createClient();
  try {
    await revokeInvitation(supabase, { id: parsed.data });
  } catch {
    // The list re-renders from the database either way.
  }
  revalidatePath("/manage/team");
}

export async function signOutEverywhereAction(formData: FormData): Promise<void> {
  await requireManager();
  const parsed = idSchema.safeParse(formData.get("employeeId"));
  if (!parsed.success) return;
  const supabase = await createClient();
  try {
    await signOutEverywhere(supabase, { employeeId: parsed.data });
  } catch {
    // Best effort; nothing sensitive to leak on failure.
  }
  revalidatePath("/manage/team");
}
