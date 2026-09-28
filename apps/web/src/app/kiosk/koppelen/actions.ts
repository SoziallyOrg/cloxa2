"use server";

import { redirect } from "next/navigation";

import { kioskPair, type KioskPairResult } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import type { FormState } from "@/lib/auth/form-state";
import { setKioskSecret } from "@/lib/kiosk/device-cookie";
import { pairErrorKey } from "@/lib/kiosk/errors";
import { normalizePairingCode } from "@/lib/kiosk/pairing-code";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * Exchanges the one-time code for the device secret, through the anon client:
 * pairing never uses (or needs) a login on the tablet.
 */
export async function pairKioskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const code = normalizePairingCode(formData.get("code"));
  if (code === null) return { error: t("kiosk.pairErrorCode") };

  let result: KioskPairResult;
  try {
    result = await kioskPair(createAnonClient(), { code });
  } catch {
    return { error: t("kiosk.pairErrorGeneric") };
  }
  if (!result.ok) return { error: t(pairErrorKey(result.error)) };

  await setKioskSecret(result.deviceSecret);
  redirect("/kiosk");
}
