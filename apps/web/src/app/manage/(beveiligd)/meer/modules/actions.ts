"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { RpcError, setOrgModule } from "@cloxa/db";
import { configFromChoices, isModuleId, moduleById } from "@cloxa/modules";

import type { ModuleActionResult } from "@/components/modules/ModuleSwitchSection";
import { requireManager } from "@/lib/auth/context";
import { loadOrgModuleRows } from "@/lib/modules/load";
import { createClient } from "@/lib/supabase/server";

async function requireOrgAdmin() {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  return context;
}

function failure(error: unknown): ModuleActionResult {
  return {
    ok: false,
    errorKey:
      error instanceof RpcError && error.message === "not_authorized"
        ? "modules.errorNotAuthorized"
        : "modules.errorGeneric",
  };
}

function revalidateModules(moduleId: string): void {
  revalidatePath("/manage/meer/modules");
  revalidatePath(`/manage/meer/modules/${moduleId}`);
}

/**
 * Switch a module on or off, keeping its settings. Owners and admins only;
 * the database checks it again (fresh MFA included) and writes the log.
 */
export async function setModuleEnabledAction(
  moduleId: string,
  enabled: boolean,
): Promise<ModuleActionResult> {
  const context = await requireOrgAdmin();
  if (!isModuleId(moduleId) || typeof enabled !== "boolean") {
    return { ok: false, errorKey: "modules.errorGeneric" };
  }
  const supabase = await createClient();
  try {
    const rows = await loadOrgModuleRows(supabase, context.membership.organizationId);
    const current = rows.get(moduleId)?.config;
    const config = configFromChoices(
      moduleById(moduleId),
      current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)
        : {},
    );
    await setOrgModule(supabase, {
      organizationId: context.membership.organizationId,
      module: moduleId,
      enabled,
      config: config.ok ? config.config : {},
    });
  } catch (error) {
    return failure(error);
  }
  revalidateModules(moduleId);
  return { ok: true };
}

const choicesSchema = z.record(z.string(), z.string().max(64));

/** Save a module's settings (e.g. the overuren sector), on or off as it is. */
export async function setModuleConfigAction(
  moduleId: string,
  values: Record<string, string>,
): Promise<ModuleActionResult> {
  const context = await requireOrgAdmin();
  const parsed = choicesSchema.safeParse(values);
  if (!isModuleId(moduleId) || !parsed.success) {
    return { ok: false, errorKey: "modules.errorGeneric" };
  }
  const config = configFromChoices(moduleById(moduleId), parsed.data);
  if (!config.ok) return { ok: false, errorKey: "modules.errorGeneric" };

  const supabase = await createClient();
  try {
    const rows = await loadOrgModuleRows(supabase, context.membership.organizationId);
    await setOrgModule(supabase, {
      organizationId: context.membership.organizationId,
      module: moduleId,
      enabled: rows.get(moduleId)?.enabled ?? false,
      config: config.config,
    });
  } catch (error) {
    return failure(error);
  }
  revalidateModules(moduleId);
  return { ok: true };
}
