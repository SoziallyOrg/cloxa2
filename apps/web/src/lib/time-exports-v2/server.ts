import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseV2History, parseV2Snapshot } from "./model";
import { v2DatasetHash } from "./serializer";
export async function getV2History() {
  try {
    const client = await createSupabaseServerClient();
    const id = randomUUID();
    const { data, error } = await client.rpc("get_time_exports_v2", { request_id: id });
    return error ? null : parseV2History(data, id);
  } catch {
    return null;
  }
}
export async function getV2Snapshot(exportId: string) {
  try {
    const client = await createSupabaseServerClient();
    const id = randomUUID();
    const { data, error } = await client.rpc("get_time_export_v2_snapshot", {
      request_id: id,
      export_id: exportId,
    });
    const result = error ? null : parseV2Snapshot(data, id);
    return result &&
      result.manifest.export_id === exportId &&
      v2DatasetHash(result) === result.manifest.dataset_sha256
      ? result
      : null;
  } catch {
    return null;
  }
}
