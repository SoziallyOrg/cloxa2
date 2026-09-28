import { myDataExport, RpcError } from "@cloxa/db";
import { brusselsDayKey } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { getAuthContext } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { downloadHeaders } from "@/lib/exports/download";
import { createClient } from "@/lib/supabase/server";

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
 * "Download al mijn gegevens (JSON)": the signed-in person's own data in
 * every organization where they are active (AVG art. 15). The RPC works
 * from auth.uid() only and audits the download per organization.
 */
export async function GET(): Promise<Response> {
  const context = await getAuthContext();
  if (context.kind !== "member" || context.employeeId === null) return refuse(403);

  let document;
  try {
    document = await myDataExport(await createClient());
  } catch (error) {
    if (error instanceof RpcError && error.code === "42501") return refuse(403);
    throw error;
  }

  return new Response(JSON.stringify(document, null, 2), {
    headers: downloadHeaders(`mijn-gegevens_${brusselsDayKey(nowMs())}.json`, "json"),
  });
}
