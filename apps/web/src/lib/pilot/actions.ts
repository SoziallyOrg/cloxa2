"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { submitPilotRequest } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import { pilotRequestKeys } from "@/lib/auth/limiter";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { createServiceClient } from "@/lib/supabase/server";

import {
  HONEYPOT_FIELD,
  parsePilotForm,
  pilotValues,
  readPilotForm,
  type PilotFormState,
} from "./form";
import { notifyOperator } from "./notify";

const SENT_PATH = "/aanvragen/verstuurd";

/**
 * The pilot request form. Every path that gets past validation ends on the same
 * "thank you" page, whether the request was stored, rate limited (3 per email
 * and 10 per IP per day, in the database) or caught by the honeypot, so a bot
 * learns nothing about which check it hit. Order: honeypot, validation,
 * Turnstile, then the limiter (inside the database call), like the login forms:
 * bots must not use up a real person's limits.
 *
 * The operator mail goes out in `after()` and only for a stored request.
 * Nothing is ever sent to the submitter.
 */
export async function submitPilot(
  _previous: PilotFormState,
  formData: FormData,
): Promise<PilotFormState> {
  const raw = readPilotForm(formData);

  // Real people never see this field.
  if (raw[HONEYPOT_FIELD] !== "") redirect(SENT_PATH);

  const parsed = parsePilotForm(raw);
  if (!parsed.ok) {
    return { error: null, fieldErrors: parsed.fieldErrors, values: parsed.values };
  }
  const { data } = parsed;
  const keep = { fieldErrors: {}, values: pilotValues(raw) };

  const human = await verifyTurnstile(formData, "pilot");
  if (human === "unavailable") return { error: t("pilot.unavailable"), ...keep };
  if (human === "failed") return { error: t("auth.turnstile.failed"), ...keep };

  let stored: boolean;
  try {
    const keys = await pilotRequestKeys(data.email);
    stored = await submitPilotRequest(createServiceClient(), {
      companyName: data.company,
      vatNumber: data.vat,
      contactName: data.name,
      email: data.email,
      phone: data.phone,
      employeeRange: data.employees,
      sector: data.sector,
      message: data.message,
      consent: true,
      emailHash: keys.emailHash,
      ipHash: keys.ipHash,
    });
  } catch (error) {
    // The code only: never the request, which holds personal data.
    console.error(
      "pilot_request_failed",
      (error as { code?: string }).code ?? "unknown",
    );
    return { error: t("pilot.unavailable"), ...keep };
  }

  if (stored) after(() => notifyOperator(data));
  redirect(SENT_PATH);
}
