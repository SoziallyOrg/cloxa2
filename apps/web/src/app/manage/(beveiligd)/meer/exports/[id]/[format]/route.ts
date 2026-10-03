import {
  recordExportDownload,
  recordExportIntegrityFailure,
  RpcError,
} from "@cloxa/db";
import { t } from "@cloxa/i18n";
import { z } from "zod";

import { getAuthContext, manageGate } from "@/lib/auth/context";
import { isPrivileged } from "@/lib/auth/routing";
import { exportContentSchema } from "@/lib/exports/content";
import { serializeExportCsv } from "@/lib/exports/csv";
import { downloadHeaders, exportFilename, jsonEnvelope } from "@/lib/exports/download";
import { downloadAccess, integrityVerdict } from "@/lib/exports/route-decisions";
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
 * The download RPC writes the audit row before it hands over the content,
 * and only for an export of the organization selected in the app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return refuse(404, t("exports.downloadDenied"));

  const context = await getAuthContext();
  const member = context.kind === "member" ? context : null;
  const privileged = member !== null && isPrivileged(member.membership.role);
  const gateOk =
    member !== null && privileged && (await manageGate(member)).kind === "ok";
  if (member === null || downloadAccess({ member: true, privileged, gateOk }) === 403) {
    return refuse(403, t("exports.downloadDenied"));
  }
  const organizationId = member.membership.organizationId;

  const supabase = await createClient();
  let stored;
  try {
    stored = await recordExportDownload(supabase, {
      organizationId,
      exportId: parsed.data.id,
      format: parsed.data.format,
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "42501") {
      return refuse(404, t("exports.downloadDenied"));
    }
    throw error;
  }

  const bytes = Buffer.from(stored.content, "utf8");
  const verdict = integrityVerdict({
    storedSha256Hex: stored.content_sha256_hex,
    actualSha256Hex: sha256Hex(bytes),
    signature: checkExportSignature(bytes, stored.signature_hex, stored.signing_key_id),
  });
  if (!verdict.ok) {
    console.error("export_integrity_failed", stored.id, verdict.reason);
    try {
      await recordExportIntegrityFailure(supabase, {
        organizationId,
        exportId: stored.id,
        reason: verdict.reason,
      });
    } catch (error) {
      console.error("export_integrity_audit_failed", (error as { code?: string }).code);
    }
    return refuse(verdict.status, t("exports.downloadIntegrity"));
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
