import { z } from "zod";

import { PILOT_EMPLOYEE_RANGES, PILOT_SECTORS } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import { parseBeVat } from "./vat";

/** Names of the request form's inputs. `HONEYPOT_FIELD` is the trap for bots. */
export const PILOT_FIELDS = [
  "company",
  "vat",
  "name",
  "email",
  "phone",
  "employees",
  "sector",
  "message",
] as const;
export type PilotField = (typeof PILOT_FIELDS)[number];
export const CONSENT_FIELD = "consent";
export const HONEYPOT_FIELD = "website";

export type PilotValues = Record<PilotField, string>;
export type PilotFieldErrors = Partial<
  Record<PilotField | typeof CONSENT_FIELD, string>
>;

/** What the form shows after a submit: it keeps what people typed, since React resets forms. */
export interface PilotFormState {
  error: string | null;
  fieldErrors: PilotFieldErrors;
  values: PilotValues;
}

const EMPTY_VALUES: PilotValues = {
  company: "",
  vat: "",
  name: "",
  email: "",
  phone: "",
  employees: "",
  sector: "",
  message: "",
};

export const INITIAL_PILOT_STATE: PilotFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_VALUES,
};

const required = () => t("pilot.errors.required");
const tooLong = () => t("pilot.errors.tooLong");

const shortText = () => z.string().trim().min(1, required()).max(200, tooLong());

const schema = z.object({
  company: shortText(),
  vat: z
    .string()
    .trim()
    .min(1, required())
    .transform((value, context) => {
      const vat = parseBeVat(value);
      if (vat === null) {
        context.addIssue({ code: "custom", message: t("pilot.errors.vatInvalid") });
        return z.NEVER;
      }
      return vat;
    }),
  name: shortText(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, required())
    .pipe(
      z.email(t("pilot.errors.emailInvalid")).max(254, t("pilot.errors.emailInvalid")),
    ),
  phone: z.string().trim().max(40, tooLong()),
  employees: z.enum(PILOT_EMPLOYEE_RANGES, { error: () => t("pilot.errors.choose") }),
  sector: z.enum(PILOT_SECTORS, { error: () => t("pilot.errors.choose") }),
  message: z.string().trim().max(1000, t("pilot.errors.messageTooLong")),
  [CONSENT_FIELD]: z.literal("on", { error: () => t("pilot.errors.consent") }),
});

export type ParsedPilotRequest = Omit<z.output<typeof schema>, typeof CONSENT_FIELD>;

export type PilotParseResult =
  | { ok: true; data: ParsedPilotRequest }
  | { ok: false; values: PilotValues; fieldErrors: PilotFieldErrors };

/** Every text input as a string; anything else (files, missing) counts as empty. */
export function readPilotForm(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const name of [...PILOT_FIELDS, CONSENT_FIELD, HONEYPOT_FIELD]) {
    const value = formData.get(name);
    raw[name] = typeof value === "string" ? value : "";
  }
  return raw;
}

export function parsePilotForm(raw: Record<string, string>): PilotParseResult {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    const { company, vat, name, email, phone, employees, sector, message } =
      parsed.data;
    return {
      ok: true,
      data: { company, vat, name, email, phone, employees, sector, message },
    };
  }

  const fieldErrors: PilotFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in fieldErrors)) {
      fieldErrors[field as PilotField | typeof CONSENT_FIELD] = issue.message;
    }
  }
  return { ok: false, values: pilotValues(raw), fieldErrors };
}

/** What the visitor typed, to put back in the form. */
export function pilotValues(raw: Record<string, string>): PilotValues {
  const values = { ...EMPTY_VALUES };
  for (const field of PILOT_FIELDS) values[field] = raw[field] ?? "";
  return values;
}
