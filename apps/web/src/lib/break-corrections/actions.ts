"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  uuid,
  version,
  parseBreakCorrectionResponse,
  type BreakActionState,
} from "./model";
import { breakCopy } from "./copy";
const input = z
  .object({
    request_id: uuid,
    intent: z.enum([
      "missed_break",
      "adjustment",
      "removal",
      "withdraw",
      "approve",
      "reject",
    ]),
    target_id: uuid.nullable(),
    entry_id: uuid.nullable(),
    expected_parent_version: version.nullable(),
    expected_break_version: version.nullable(),
    start_local: z.string().nullable(),
    end_local: z.string().nullable(),
    start_occurrence: z.enum(["", "earlier", "later"]).nullable(),
    end_occurrence: z.enum(["", "earlier", "later"]).nullable(),
    reason: z.string().max(500).nullable(),
    confirmed: z.boolean(),
  })
  .strict();
function wallTime(value: string | null) {
  if (value === null) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)$/u.exec(
    value,
  );
  if (!m) throw new Error("invalid");
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
}
export async function changeBreakCorrection(value: unknown): Promise<BreakActionState> {
  const parsed = input.safeParse(value);
  if (!parsed.success) return { message: breakCopy.invalid };
  const p = parsed.data;
  try {
    const manager = p.intent === "approve" || p.intent === "reject";
    const auth = await getAuthContext();
    if (auth.state !== "authorized" || auth.role !== (manager ? "manager" : "employee"))
      return { message: breakCopy.failure };
    const client = await createSupabaseServerClient();
    const response = manager
      ? await client.rpc("decide_break_correction", {
          request_id: p.request_id,
          correction_request_id: p.target_id!,
          decision: p.intent,
          manager_note: p.reason ?? "",
          confirmed: p.confirmed,
        })
      : await client.rpc("change_break_correction", {
          request_id: p.request_id,
          intent: p.intent,
          entry_id: p.entry_id!,
          target_id: p.target_id!,
          expected_parent_version: p.expected_parent_version!,
          expected_break_version: p.expected_break_version!,
          start_local: wallTime(p.start_local)!,
          end_local: wallTime(p.end_local)!,
          start_occurrence: p.start_occurrence!,
          end_occurrence: p.end_occurrence!,
          reason: p.reason!,
        });
    if (response.error) {
      if (response.error.message === "correction_nonexistent_local_time")
        return { message: breakCopy.gap };
      if (response.error.message === "correction_ambiguous_local_time")
        return { message: breakCopy.ambiguous };
      return { message: breakCopy.failure };
    }
    const outcome = parseBreakCorrectionResponse(
      response.data,
      p.request_id,
      p.intent,
      p.target_id ?? undefined,
    );
    if (!outcome) return { message: breakCopy.failure };
    for (const path of [
      "/employee",
      "/employee/corrections",
      "/employee/break-corrections",
      "/manager/corrections",
      "/manager/break-corrections",
      "/manager/exports",
      "/manager/exports-v2",
    ])
      revalidatePath(path);
    return {
      message: breakCopy.results[outcome.result_code],
      requestId: p.request_id,
      code: outcome.result_code,
    };
  } catch {
    return { message: breakCopy.failure };
  }
}
