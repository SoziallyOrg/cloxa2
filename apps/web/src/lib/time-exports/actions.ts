"use server";

import { revalidatePath } from "next/cache";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";
import { isUuid } from "@/lib/corrections/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isLocalDate,
  isValidExportPeriod,
  parseTimeExportManifest,
  parseTimeExportPreview,
  type ExportActionState,
  type TimeExportBlocker,
} from "@/lib/time-exports/model";

function exactForm(formData: FormData, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  for (const key of formData.keys())
    if (!allowedSet.has(key) || formData.getAll(key).length !== 1) return false;
  return [...allowedSet].every((key) => formData.has(key));
}

function todayUtcDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function period(formData: FormData) {
  const start = formData.get("period_start_local");
  const end = formData.get("period_end_local");
  if (
    !isLocalDate(start) ||
    !isLocalDate(end) ||
    !isValidExportPeriod(start, end, todayUtcDate())
  )
    return null;
  return { start, end };
}

async function authorizedClient() {
  const supabase = await createSupabaseServerClient();
  const context = await getAuthContext(supabase);
  return context.state === "authorized" && context.role === "manager" ? supabase : null;
}

export async function previewTimeExportAction(
  formData: FormData,
): Promise<ExportActionState> {
  const copy = nlBE.managerExports;
  if (!exactForm(formData, ["period_start_local", "period_end_local"]))
    return { status: "error", message: copy.invalidPeriod };
  const selected = period(formData);
  if (!selected) return { status: "error", message: copy.invalidPeriod };
  try {
    const supabase = await authorizedClient();
    if (!supabase) return { status: "error", message: copy.previewFailure };
    const { data, error } = await supabase.rpc("preview_time_export", {
      period_start_local: selected.start,
      period_end_local: selected.end,
    });
    const preview = error ? null : parseTimeExportPreview(data);
    return preview &&
      preview.periodStartLocal === selected.start &&
      preview.periodEndLocal === selected.end
      ? { status: "success", message: copy.previewReady, preview }
      : { status: "error", message: copy.previewFailure };
  } catch {
    return { status: "error", message: copy.previewFailure };
  }
}

function blockerMessage(blocker: TimeExportBlocker) {
  const copy = nlBE.managerExports;
  return blocker === "break_data_requires_v2"
    ? copy.blockers.breakDataRequiresV2
    : blocker === "no_records"
      ? copy.blockers.noRecords
      : blocker === "open_entry"
        ? copy.blockers.openEntry
        : blocker === "pending_correction"
          ? copy.blockers.pendingCorrection
          : blocker === "row_limit"
            ? copy.blockers.rowLimit
            : copy.blockers.artifactTooLarge;
}

export async function createTimeExportAction(
  formData: FormData,
): Promise<ExportActionState> {
  const copy = nlBE.managerExports;
  if (
    !exactForm(formData, [
      "request_id",
      "period_start_local",
      "period_end_local",
      "confirmed",
    ])
  )
    return { status: "error", message: copy.createFailure };
  const requestId = formData.get("request_id");
  const selected = period(formData);
  if (!isUuid(requestId) || !selected || formData.get("confirmed") !== "true")
    return { status: "error", message: copy.createFailure };
  try {
    const supabase = await authorizedClient();
    if (!supabase) return { status: "error", message: copy.createFailure };
    const { data, error } = await supabase.rpc("create_time_export", {
      request_id: requestId,
      period_start_local: selected.start,
      period_end_local: selected.end,
      confirmed: true,
    });
    const row = !error && Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (
      !row ||
      Object.keys(row).sort().join(",") !== "did_create,export_id,manifest,result_code"
    )
      return { status: "error", message: copy.createFailure };
    if (row.result_code !== "created") {
      if (
        row.did_create !== false ||
        row.export_id !== null ||
        row.manifest !== null ||
        ![
          "no_records",
          "open_entry",
          "pending_correction",
          "row_limit",
          "artifact_too_large",
          "break_data_requires_v2",
        ].includes(row.result_code)
      )
        return { status: "error", message: copy.createFailure };
      return {
        status: "error",
        message: blockerMessage(row.result_code as TimeExportBlocker),
      };
    }
    const manifest = parseTimeExportManifest(row.manifest);
    if (
      row.did_create !== true ||
      !isUuid(row.export_id) ||
      !manifest ||
      manifest.exportId !== row.export_id ||
      manifest.periodStartLocal !== selected.start ||
      manifest.periodEndLocal !== selected.end
    )
      return { status: "error", message: copy.createFailure };
    revalidatePath("/manager/exports");
    return { status: "success", message: copy.created, manifest };
  } catch {
    return { status: "error", message: copy.createFailure };
  }
}
