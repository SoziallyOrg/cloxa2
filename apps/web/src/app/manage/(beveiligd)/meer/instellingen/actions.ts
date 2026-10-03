"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { RpcError, updateOrgSettings } from "@cloxa/db";
import type { CatalogKey } from "@cloxa/i18n";

import { requireManager } from "@/lib/auth/context";
import { validateSettingsForm, type SettingsField } from "@/lib/manage/settings-form";
import { createClient } from "@/lib/supabase/server";

export interface SettingsActionResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
  readonly invalidFields?: readonly SettingsField[];
}

/** Org settings are owner/admin business; the database checks it again. */
export async function updateSettingsAction(
  input: unknown,
): Promise<SettingsActionResult> {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }

  const validated = validateSettingsForm(input);
  if (!validated.ok) return { ok: false, invalidFields: validated.invalidFields };

  try {
    await updateOrgSettings(await createClient(), {
      organizationId: context.membership.organizationId,
      ...validated.values,
    });
  } catch (error) {
    return {
      ok: false,
      errorKey:
        error instanceof RpcError && error.message === "not_authorized"
          ? "orgSettings.errorNotAuthorized"
          : "orgSettings.errorGeneric",
    };
  }
  revalidatePath("/manage/meer/instellingen");
  return { ok: true };
}
