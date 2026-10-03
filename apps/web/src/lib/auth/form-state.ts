/** Result of a form's server action, shown by its client form. */
export interface FormState {
  error: string | null;
}

export const INITIAL_FORM_STATE: FormState = { error: null };

export interface TotpEnrolment {
  factorId: string;
  /** SVG data URI from Supabase (allowed by `img-src data:`). */
  qrCode: string;
  secret: string;
}

export interface EnrolState extends FormState {
  enrolment: TotpEnrolment | null;
}

export const INITIAL_ENROL_STATE: EnrolState = { error: null, enrolment: null };

/** `ABCDEFGHIJ` → `ABCD EFGH IJ`, easier to type over by hand. */
export function groupSecret(secret: string): string {
  return (
    secret
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}

/** Six digits, ignoring spaces people type or paste between groups. */
export function parseSixDigitCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}
