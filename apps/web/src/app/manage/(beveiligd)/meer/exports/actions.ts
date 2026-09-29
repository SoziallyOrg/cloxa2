"use server";

import { revalidatePath } from "next/cache";

import { createExport, MAX_EXPORT_CONTENT_BYTES } from "@cloxa/db";

import { requireManager } from "@/lib/auth/context";
import { canonicalJson } from "@/lib/exports/canonical";
import {
  exportFormSchema,
  mapExportError,
  resolveExportScope,
  type ExportErrorKey,
  type ExportFormInput,
} from "@/lib/exports/form";
import { loadExportableSites, loadSnapshotInput } from "@/lib/exports/load";
import { signExportContent } from "@/lib/exports/sign";
import { buildExportContent } from "@/lib/exports/snapshot";
import { nowMs } from "@/lib/clock/now";
import { createClient } from "@/lib/supabase/server";

export interface CreateExportResult {
  readonly ok: boolean;
  readonly errorKey?: ExportErrorKey;
}

/**
 * Build the snapshot from what the caller can read, sign it here (the key
 * never reaches the browser) and store it. The RPC re-checks scope, period,
 * rows and size on its own.
 */
export async function createExportAction(
  input: ExportFormInput,
): Promise<CreateExportResult> {
  const context = await requireManager();
  const parsed = exportFormSchema.safeParse(input);
  if (!parsed.success) {
    const sitesIssue = parsed.error.issues.some((issue) => issue.path[0] === "siteIds");
    return {
      ok: false,
      errorKey: sitesIssue ? "exports.errorSites" : "exports.errorPeriod",
    };
  }

  const supabase = await createClient();
  try {
    const sites = await loadExportableSites(supabase, context.membership);
    const scope = resolveExportScope(
      context.membership.role,
      sites.map((site) => site.id),
      parsed.data.siteIds,
    );
    if (!scope.ok) return { ok: false, errorKey: "exports.errorSites" };

    const period = { from: parsed.data.from, to: parsed.data.to };
    const source = await loadSnapshotInput(supabase, {
      organizationId: context.membership.organizationId,
      createdBy: context.claims.userId,
      generatedAt: nowMs(),
      period,
      siteIds: scope.siteIds,
      withModules: true,
      interimAgency: parsed.data.interimAgency ?? null,
    });
    const content = buildExportContent(source);
    if (parsed.data.interimAgency !== undefined && content.rows.length === 0) {
      return { ok: false, errorKey: "exports.errorAgency" };
    }
    const text = canonicalJson(content);
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > MAX_EXPORT_CONTENT_BYTES) {
      return { ok: false, errorKey: "exports.errorTooLarge" };
    }

    const { keyId, signatureHex } = signExportContent(bytes);
    await createExport(supabase, {
      organizationId: context.membership.organizationId,
      periodFrom: period.from,
      periodTo: period.to,
      siteIds: scope.siteIds,
      rowCount: content.rows.length,
      content: text,
      signatureHex,
      signingKeyId: keyId,
      ...(content.interim_agency === undefined
        ? {}
        : { interimAgency: content.interim_agency }),
    });
  } catch (error) {
    // Codes only: no content, names or tokens in logs.
    console.error("export_create_failed", (error as { code?: string }).code ?? null);
    return { ok: false, errorKey: mapExportError(error) };
  }

  revalidatePath("/manage/meer/exports");
  return { ok: true };
}
