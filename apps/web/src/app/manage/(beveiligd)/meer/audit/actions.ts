"use server";

import { verifyChains } from "@cloxa/db";
import { formatBrusselsTime, type CatalogKey } from "@cloxa/i18n";

import { requireManager } from "@/lib/auth/context";
import {
  mapVerifyChainsError,
  toVerifyChainsResult,
  type VerifyChainsResult,
} from "@/lib/audit/verify";
import { createClient } from "@/lib/supabase/server";

export interface VerifyChainsActionResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
  readonly result?: VerifyChainsResult;
  /** Brussels wall time of the check, shown in the success message. */
  readonly checkedAt?: string;
}

/**
 * Owner only; the RPC checks again (`42501` when it isn't). `/manage/**`
 * already requires fresh MFA before this action can run at all.
 */
export async function verifyChainsAction(): Promise<VerifyChainsActionResult> {
  const context = await requireManager();
  if (context.membership.role !== "owner") {
    return { ok: false, errorKey: "audit.verifyOwnerOnly" };
  }

  const supabase = await createClient();
  try {
    const row = await verifyChains(supabase, {
      organizationId: context.membership.organizationId,
    });
    return {
      ok: true,
      result: toVerifyChainsResult(row),
      checkedAt: formatBrusselsTime(new Date()),
    };
  } catch (error) {
    return { ok: false, errorKey: mapVerifyChainsError(error) };
  }
}
