import { isUuid } from "@/lib/corrections/model";
import { getAuthContext } from "@/lib/auth/session";
import { getV2Snapshot } from "@/lib/time-exports-v2/server";
import { createV2Artifact } from "@/lib/time-exports-v2/serializer";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(
  _request: Request,
  context: { params: Promise<{ exportId: string; format: string }> },
) {
  const auth = await getAuthContext();
  if (auth.state !== "authorized" || auth.role !== "manager")
    return new Response(null, { status: 403, headers });

  const { exportId, format } = await context.params;
  if (!isUuid(exportId) || (format !== "csv" && format !== "json"))
    return new Response(null, { status: 404, headers });
  const snapshot = await getV2Snapshot(exportId);
  if (!snapshot) return new Response(null, { status: 404, headers });
  const artifact = createV2Artifact(snapshot, format);
  if (!artifact) return new Response(null, { status: 413, headers });
  return new Response(artifact.bytes, {
    headers: {
      ...headers,
      "Content-Type": artifact.contentType,
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(artifact.bytes.byteLength),
      "X-Cloxa-Artifact-SHA256": artifact.sha256,
    },
  });
}
