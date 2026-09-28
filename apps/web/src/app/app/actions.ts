"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clock, type ClockInput } from "@cloxa/db";

import { requireEmployeeArea } from "@/lib/auth/context";
import { mapClockError, type ClockErrorKey } from "@/lib/clock/errors";
import { setChosenSiteId } from "@/lib/clock/site-cookie";
import { createClient } from "@/lib/supabase/server";

export interface ClockActionResult {
  ok: boolean;
  errorKey?: ClockErrorKey;
}

/**
 * Live clocking from `/app`. Never throws to the client: the idempotency
 * key is minted client-side and reused on retry, so a thrown error there
 * would strand the caller without a way to retry with the same key.
 */
export async function clockAction(input: ClockInput): Promise<ClockActionResult> {
  await requireEmployeeArea();
  const supabase = await createClient();
  try {
    await clock(supabase, input);
  } catch (error) {
    return { ok: false, errorKey: mapClockError(error) };
  }
  // The new state travels back with this response, so the screen can't show
  // the old one after the confirmation (a separate client refresh could race).
  refresh();
  return { ok: true };
}

const siteIdSchema = z.uuid();

/** Remembers the employee's chosen site, after checking it's really theirs. */
export async function chooseSiteAction(formData: FormData): Promise<void> {
  const context = await requireEmployeeArea();
  const parsed = siteIdSchema.safeParse(formData.get("siteId"));
  if (!parsed.success) redirect("/app");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_assignments")
    .select("site_id")
    .eq("organization_id", context.membership.organizationId)
    .eq("employee_id", context.employeeId)
    .eq("site_id", parsed.data)
    .maybeSingle();
  if (error || !data) redirect("/app");

  await setChosenSiteId(parsed.data);
  redirect("/app");
}
