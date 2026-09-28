import { recordSelfExport } from "@cloxa/db";
import { brusselsDayKey } from "@cloxa/domain";
import { t } from "@cloxa/i18n";
import { z } from "zod";

import { getAuthContext } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { monthPeriod } from "@/lib/exports/brussels";
import { serializeExportCsv } from "@/lib/exports/csv";
import { downloadHeaders } from "@/lib/exports/download";
import { loadSnapshotInput } from "@/lib/exports/load";
import { buildExportContent } from "@/lib/exports/snapshot";
import { createClient } from "@/lib/supabase/server";

const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);

function refuse(status: number): Response {
  return new Response(t("exports.downloadDenied"), {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * "Download mijn uren": the signed-in employee's own hours for one month,
 * built on the fly from their own rows (RLS: self only). Not stored or
 * signed; the download is audited first.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await getAuthContext();
  if (context.kind !== "member" || context.employeeId === null) return refuse(403);

  const month = monthSchema.safeParse(new URL(request.url).searchParams.get("maand"));
  const now = nowMs();
  const today = brusselsDayKey(now);
  if (!month.success || `${month.data}-01` > today) return refuse(400);

  const period = monthPeriod(month.data, today);
  const supabase = await createClient();
  await recordSelfExport(supabase, {
    employeeId: context.employeeId,
    periodFrom: period.from,
    periodTo: period.to,
  });

  const source = await loadSnapshotInput(supabase, {
    organizationId: context.membership.organizationId,
    createdBy: context.claims.userId,
    generatedAt: now,
    period,
    siteIds: null,
    employeeIds: [context.employeeId],
  });
  const csv = serializeExportCsv(buildExportContent(source));
  return new Response(csv, {
    headers: downloadHeaders(`mijn-uren_${month.data}.csv`, "csv"),
  });
}
