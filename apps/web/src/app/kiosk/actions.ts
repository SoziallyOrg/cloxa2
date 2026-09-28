"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { kioskClock, kioskStatus, type KioskResult } from "@cloxa/db";

import { kioskFailureCode } from "@/lib/kiosk/errors";
import { clearKioskSecret, readKioskSecret } from "@/lib/kiosk/device-cookie";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * The kiosk's calls. Always the anon client with the device secret from the
 * cookie: never a user session, and the database decides everything (device,
 * site, PIN, limits). Refusals are values, never thrown, so the screen can
 * always explain what happened.
 */
export type KioskActionResult = KioskResult;

const refused = (error: string): KioskActionResult => ({
  ok: false,
  error,
  triesLeft: null,
  retryAfterSeconds: null,
});

const statusInput = z.strictObject({
  employeeId: z.uuid(),
  pin: z.string().regex(/^[0-9]{4,6}$/),
});

const clockInput = statusInput.extend({
  type: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
  idempotencyKey: z.uuid(),
});

async function withDevice(
  call: (deviceSecret: string) => Promise<KioskActionResult>,
): Promise<KioskActionResult> {
  const deviceSecret = await readKioskSecret();
  if (deviceSecret === null) return refused("device_unknown");

  let result: KioskActionResult;
  try {
    result = await call(deviceSecret);
  } catch (error) {
    return refused(kioskFailureCode(error));
  }
  // Revoked (or re-paired elsewhere): forget the secret for good.
  if (!result.ok && result.error === "device_unknown") await clearKioskSecret();
  return result;
}

export async function kioskStatusAction(input: {
  employeeId: string;
  pin: string;
}): Promise<KioskActionResult> {
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return refused("pin_invalid");
  return withDevice((deviceSecret) =>
    kioskStatus(createAnonClient(), { deviceSecret, ...parsed.data }),
  );
}

export async function kioskClockAction(input: {
  employeeId: string;
  pin: string;
  type: string;
  idempotencyKey: string;
}): Promise<KioskActionResult> {
  const parsed = clockInput.safeParse(input);
  if (!parsed.success) return refused("invalid_input");
  return withDevice((deviceSecret) =>
    kioskClock(createAnonClient(), { deviceSecret, ...parsed.data }),
  );
}

/** "Opnieuw koppelen" on a revoked tablet: forget the old secret, then pair. */
export async function forgetKioskAction(): Promise<void> {
  await clearKioskSecret();
  redirect("/kiosk/koppelen" as Route);
}
