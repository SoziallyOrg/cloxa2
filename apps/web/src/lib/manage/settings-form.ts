/**
 * Pure validation for the org settings form (`/manage/meer/instellingen`).
 * Form values arrive as strings; the bounds are the ones the RPC enforces
 * (`ORG_SETTING_BOUNDS` from `@cloxa/db`), and the database checks again.
 */
import { z } from "zod";

import { ORG_SETTING_BOUNDS } from "@cloxa/db";

import { MIN_RETENTION_YEARS } from "./offboarding";

const wholeNumber = (bounds: { readonly min: number; readonly max: number }) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(bounds.min).max(bounds.max));

export const settingsFormSchema = z.strictObject({
  retentionYears: wholeNumber(ORG_SETTING_BOUNDS.retentionYears),
  offlineClocking: z.boolean(),
  offlineMaxSkewMinutes: wholeNumber(ORG_SETTING_BOUNDS.offlineMaxSkewMinutes),
  correctionMaxAgeDays: wholeNumber(ORG_SETTING_BOUNDS.correctionMaxAgeDays),
});

export type SettingsFormInput = z.input<typeof settingsFormSchema>;
export type SettingsFormValues = z.output<typeof settingsFormSchema>;
export type SettingsField = keyof SettingsFormValues;

export type SettingsFormResult =
  | { readonly ok: true; readonly values: SettingsFormValues }
  | { readonly ok: false; readonly invalidFields: readonly SettingsField[] };

export function validateSettingsForm(input: unknown): SettingsFormResult {
  const parsed = settingsFormSchema.safeParse(input);
  if (parsed.success) return { ok: true, values: parsed.data };
  const invalid = new Set<SettingsField>();
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in settingsFormSchema.shape) {
      invalid.add(field as SettingsField);
    }
  }
  return { ok: false, invalidFields: [...invalid] };
}

/** The values in force, with the database defaults for keys never set. */
export function currentSettings(settings: unknown): SettingsFormValues {
  const raw =
    settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const int = (key: string, fallback: number) => {
    const value = raw[key];
    return typeof value === "number" && Number.isInteger(value) ? value : fallback;
  };
  return {
    retentionYears: Math.max(MIN_RETENTION_YEARS, int("retention_years", 5)),
    offlineClocking: raw["offline_clocking"] !== false,
    offlineMaxSkewMinutes: int("offline_max_skew_minutes", 240),
    correctionMaxAgeDays: int("correction_max_age_days", 60),
  };
}
