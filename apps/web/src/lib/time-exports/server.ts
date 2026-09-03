import "server-only";
import { computeDatasetSha256 } from "@/lib/time-exports/serializer";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseTimeExportHistory,
  parseTimeExportSnapshot,
} from "@/lib/time-exports/model";

export async function getManagerTimeExports() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_manager_time_exports");
    return error ? null : parseTimeExportHistory(data);
  } catch {
    return null;
  }
}

export async function getTimeExportSnapshot(exportId: string) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_time_export_snapshot", {
      export_id: exportId,
    });
    const snapshot = error ? null : parseTimeExportSnapshot(data);
    return snapshot &&
      snapshot.manifest.exportId === exportId &&
      computeDatasetSha256(snapshot) === snapshot.manifest.datasetSha256
      ? snapshot
      : null;
  } catch {
    return null;
  }
}
