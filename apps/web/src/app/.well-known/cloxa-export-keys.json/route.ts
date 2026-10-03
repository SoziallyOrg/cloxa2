import { publishedExportKeys } from "@/lib/exports/sign";

// Read at request time: the key comes from the runtime env (or a per-process dev key).
export const dynamic = "force-dynamic";

/** Public Ed25519 keys (JWK) that verify downloaded exports. Safe to publish. */
export function GET(): Response {
  return Response.json(publishedExportKeys(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
