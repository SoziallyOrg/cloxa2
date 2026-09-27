"use server";

import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEmployeeTimeClock } from "./server";
import type { WorkSnapshot } from "./workspace-clock";

/** Read-only and actor-bound; never reuse another account's clock response. */
export async function readWorkStatus(scope: string): Promise<WorkSnapshot | null> {
  try {
    const client = await createSupabaseServerClient();
    const auth = await getAuthContext(client);
    if (
      auth.state !== "authorized" ||
      auth.role !== "employee" ||
      `${auth.userId}:${auth.organizationId}` !== scope
    )
      return null;
    const clock = await getEmployeeTimeClock(client);
    return clock
      ? {
          status: clock.status,
          currentStartedAt: clock.currentStartedAt,
          serverTime: clock.serverTime,
        }
      : null;
  } catch {
    return null;
  }
}
