"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clock,
  clockOffline,
  RpcError,
  type ClockInput,
  type ClockOfflineInput,
} from "@cloxa/db";

import { requireEmployeeArea } from "@/lib/auth/context";
import { mapClockError, type ClockErrorKey } from "@/lib/clock/errors";
import { setChosenSiteId } from "@/lib/clock/site-cookie";
import { outcomeFromError, outcomeFromResult } from "@/lib/offline/outcome";
import type { SyncOutcome } from "@/lib/offline/queue";
import { createClient } from "@/lib/supabase/server";

export interface ClockActionResult {
  ok: boolean;
  errorKey?: ClockErrorKey;
}

/**
 * The clock-in is the fact; where it happens is extra. When telework was
 * switched off between the question and the press (or while the press sat in
 * the offline queue), the clock-in is recorded without a location.
 */
async function withoutLocationWhenOff<I extends { workLocation?: unknown }, R>(
  input: I,
  send: (input: I) => Promise<R>,
): Promise<R> {
  try {
    return await send(input);
  } catch (error) {
    if (
      input.workLocation === undefined ||
      !(error instanceof RpcError) ||
      error.message !== "telework_disabled"
    ) {
      throw error;
    }
    const rest = { ...input };
    delete rest.workLocation;
    return send(rest);
  }
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
    await withoutLocationWhenOff(input, (next) => clock(supabase, next));
  } catch (error) {
    return { ok: false, errorKey: mapClockError(error) };
  }
  // The new state travels back with this response, so the screen can't show
  // the old one after the confirmation (a separate client refresh could race).
  refresh();
  return { ok: true };
}

/**
 * Syncs one queued offline clock action (ADR 006). Like `clockAction`, it
 * never throws: the queue keeps the entry on `retry` and drops it otherwise.
 */
export async function syncOfflineClockAction(
  input: ClockOfflineInput,
): Promise<SyncOutcome> {
  await requireEmployeeArea();
  const supabase = await createClient();
  let outcome: SyncOutcome;
  try {
    outcome = outcomeFromResult(
      await withoutLocationWhenOff(input, (next) => clockOffline(supabase, next)),
    );
  } catch (error) {
    return outcomeFromError(error);
  }
  // A recorded event or a new request changes what the screen shows.
  if (outcome.outcome !== "rejected") refresh();
  return outcome;
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
