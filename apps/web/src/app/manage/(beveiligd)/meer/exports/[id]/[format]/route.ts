import { recordExportDownload, RpcError } from "@cloxa/db";
import { t } from "@cloxa/i18n";
import { z } from "zod";

import { getAuthContext, manageGate } from "@/lib/auth/context";
import { isPrivileged } from "@/lib/auth/routing";
import { exportContentSchema } from "@/lib/exports/content";
import { serializeExportCsv } from "@/lib/exports/csv";
import { downloadHeaders, exportFilename, jsonEnvelope } from "@/lib/exports/download";
import { checkExportSignature } from "@/lib/exports/sign";
import { sha256Hex } from "@/lib/exports/signing";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.strictObject({
  id: z.uuid(),
  format: z.enum(["csv", "json"]),
});

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * A route handler is a public endpoint: the /manage layout does not run
 * here, so the privileged-session checks are repeated before anything else.
 * The download RPC writes the audit row before it hands over the content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return refuse(404, t("exports.downloadDenied"));

  const context = await getAuthContext();
  if (context.kind !== "member" || !isPrivileged(context.membership.role)) {
    return refuse(403, t("exports.downloadDenied"));
  }
  const gate = await manageGate(context);
  if (gate.kind !== "ok") return refuse(403, t("exports.downloadDenied"));

  const supabase = await createClient();
  let stored;
  try {
    stored = await recordExportDownload(supabase, {
      exportId: parsed.data.id,
      format: parsed.data.format,
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "42501") {
      return refuse(404, t("exports.downloadDenied"));
    }
    throw error;
  }

  // Serve only what still matches its hash and a signature we can vouch for.
  const bytes = Buffer.from(stored.content, "utf8");
  const intact =
    sha256Hex(bytes) === stored.content_sha256_hex &&
    checkExportSignature(bytes, stored.signature_hex, stored.signing_key_id) !==
      "invalid";
  if (!intact) {
    console.error("export_integrity_failed", stored.id);
    return refuse(409, t("exports.downloadIntegrity"));
  }

  const period = { from: stored.period_from, to: stored.period_to };
  const filename = exportFilename(
    period,
    stored.content_sha256_hex,
    parsed.data.format,
  );

  if (parsed.data.format === "json") {
    const body = jsonEnvelope(stored.content, {
      sha256Hex: stored.content_sha256_hex,
      signatureHex: stored.signature_hex,
      keyId: stored.signing_key_id,
    });
    return new Response(body, { headers: downloadHeaders(filename, "json") });
  }

  const content = exportContentSchema.parse(JSON.parse(stored.content));
  return new Response(serializeExportCsv(content), {
    headers: downloadHeaders(filename, "csv"),
  });
}
