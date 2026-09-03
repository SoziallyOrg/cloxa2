import { isUuid } from "@/lib/corrections/model";
import { getTimeExportSnapshot } from "@/lib/time-exports/server";
import {
  createTimeExportArtifact,
  type TimeExportFormat,
} from "@/lib/time-exports/serializer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const baseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportId: string; format: string }> },
) {
  const { exportId, format } = await context.params;
  if (!isUuid(exportId) || (format !== "csv" && format !== "json"))
    return new Response(null, { status: 404, headers: baseHeaders });
  const snapshot = await getTimeExportSnapshot(exportId);
  if (!snapshot) return new Response(null, { status: 404, headers: baseHeaders });
  const artifact = createTimeExportArtifact(snapshot, format as TimeExportFormat);
  if (!artifact) return new Response(null, { status: 413, headers: baseHeaders });
  return new Response(artifact.bytes, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Type": artifact.contentType,
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(artifact.bytes.byteLength),
      "X-Cloxa-Artifact-SHA256": artifact.sha256,
    },
  });
}
