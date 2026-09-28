"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  kioskCreate,
  kioskNewPairingCode,
  kioskRevoke,
  type KioskPairingCode,
} from "@cloxa/db";
import { formatBrusselsTime, type CatalogKey } from "@cloxa/i18n";

import { requireManager, type MemberContext } from "@/lib/auth/context";
import { manageKioskErrorKey } from "@/lib/kiosk/errors";
import { formatPairingCode } from "@/lib/kiosk/pairing-code";
import { createClient } from "@/lib/supabase/server";

export interface PairingCodeResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
  /** `ABCD-2345`, shown once. */
  readonly code?: string;
  /** Brussels wall time the code stops working. */
  readonly expiresAt?: string;
}

/** Kiosks are owner/admin business; the database checks it again. */
async function requireKioskAdmin(): Promise<MemberContext> {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  return context;
}

function shown(code: KioskPairingCode): PairingCodeResult {
  return {
    ok: true,
    code: formatPairingCode(code.pairingCode),
    expiresAt: formatBrusselsTime(new Date(code.expiresAt)),
  };
}

const createInput = z.strictObject({
  siteId: z.uuid(),
  name: z.string().trim().min(1).max(100),
});

export async function createKioskAction(input: {
  siteId: string;
  name: string;
}): Promise<PairingCodeResult> {
  await requireKioskAdmin();
  const parsed = createInput.safeParse(input);
  if (!parsed.success) {
    const nameProblem = parsed.error.issues.some((issue) => issue.path[0] === "name");
    return {
      ok: false,
      errorKey: nameProblem ? "manageKiosks.errorName" : "manageKiosks.errorSite",
    };
  }

  const supabase = await createClient();
  let result: PairingCodeResult;
  try {
    result = shown(await kioskCreate(supabase, parsed.data));
  } catch (error) {
    return { ok: false, errorKey: manageKioskErrorKey(error) };
  }
  revalidatePath("/manage/meer/kiosks");
  return result;
}

const deviceId = z.uuid();

export async function newPairingCodeAction(id: string): Promise<PairingCodeResult> {
  await requireKioskAdmin();
  const parsed = deviceId.safeParse(id);
  if (!parsed.success) return { ok: false, errorKey: "manageKiosks.errorGeneric" };

  const supabase = await createClient();
  try {
    return shown(await kioskNewPairingCode(supabase, { deviceId: parsed.data }));
  } catch (error) {
    return { ok: false, errorKey: manageKioskErrorKey(error) };
  }
}

export async function revokeKioskAction(formData: FormData): Promise<void> {
  await requireKioskAdmin();
  const parsed = deviceId.safeParse(formData.get("deviceId"));
  if (!parsed.success) return;
  const supabase = await createClient();
  try {
    await kioskRevoke(supabase, { deviceId: parsed.data });
  } catch {
    // The list re-renders from the database either way.
  }
  revalidatePath("/manage/meer/kiosks");
}
