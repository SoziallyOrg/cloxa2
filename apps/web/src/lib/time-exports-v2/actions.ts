"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/break-corrections/model";
import { parseV2Creation, parseV2Preview, type V2ActionState } from "./model";
const schema = z
  .object({
    request_id: uuid,
    intent: z.enum(["preview", "create"]),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    confirmed: z.boolean(),
  })
  .strict();
export async function exportV2Action(value: unknown): Promise<V2ActionState> {
  const p = schema.safeParse(value);
  if (!p.success) return { message: "Controleer de periode en bevestiging." };
  const v = p.data;
  try {
    const auth = await getAuthContext();
    if (auth.state !== "authorized" || auth.role !== "manager")
      return { message: "Export kan niet worden verwerkt." };
    const client = await createSupabaseServerClient();
    const args = {
      request_id: v.request_id,
      period_start_local: v.start,
      period_end_local: v.end,
    };
    const { data, error } =
      v.intent === "preview"
        ? await client.rpc("preview_time_export_v2", args)
        : await client.rpc("create_time_export_v2", {
            ...args,
            confirmed: v.confirmed,
          });
    if (error)
      return {
        message: "Export niet bevestigd. Controleer de periode en probeer opnieuw.",
      };
    if (v.intent === "preview") {
      const preview = parseV2Preview(data, v.request_id, v.start, v.end);
      return preview
        ? { message: "Exportvoorbeeld geladen.", requestId: v.request_id, preview }
        : {
            message: "Exportvoorbeeld kon niet worden gecontroleerd. Probeer opnieuw.",
          };
    }
    const result = parseV2Creation(data, v.request_id);
    if (!result)
      return {
        message: "Export niet bevestigd. Probeer opnieuw met dezelfde gegevens.",
      };
    revalidatePath("/manager/exports-v2");
    return {
      requestId: v.request_id,
      message: result.did_create
        ? "Export v2 vastgelegd."
        : "Export geblokkeerd. Laad een nieuw voorbeeld en handel de blokkades af.",
      ...(result.manifest ? { manifest: result.manifest } : {}),
    };
  } catch {
    return { message: "Export niet bevestigd. Probeer opnieuw met dezelfde gegevens." };
  }
}
