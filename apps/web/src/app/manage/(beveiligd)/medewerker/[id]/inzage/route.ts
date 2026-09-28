import { RpcError, subjectExport } from "@cloxa/db";
import { brusselsDayKey } from "@cloxa/domain";
import { t } from "@cloxa/i18n";
import { z } from "zod";

import { getAuthContext, manageGate } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { downloadHeaders } from "@/lib/exports/download";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

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
 * "Inzage-export (AVG)": everything Cloxa holds about one person in the org,
 * for a data-subject access request. A route handler is a public endpoint,
 * so the /manage checks are repeated; the RPC re-checks owner/admin with
 * fresh MFA and writes the audit row before it answers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return refuse(404);

  const context = await getAuthContext();
  if (context.kind !== "member") return refuse(403);
  const role = context.membership.role;
  if (role !== "owner" && role !== "admin") return refuse(403);
  if ((await manageGate(context)).kind !== "ok") return refuse(403);

  let document;
  try {
    document = await subjectExport(await createClient(), { employeeId: id.data });
  } catch (error) {
    if (error instanceof RpcError && error.code === "42501") return refuse(403);
    throw error;
  }

  // The id prefix only tells files apart; no name in the filename (it ends up in logs).
  const filename = `inzage_${id.data.slice(0, 8)}_${brusselsDayKey(nowMs())}.json`;
  return new Response(JSON.stringify(document, null, 2), {
    headers: downloadHeaders(filename, "json"),
  });
}
