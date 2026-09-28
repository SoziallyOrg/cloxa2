/**
 * Pure validation for "Medewerker uitnodigen". Mirrors `inviteMemberInput`
 * (`@cloxa/db`) field-for-field so the form fails early with the same
 * rules the RPC enforces, but stays a plain object here (no organization id
 * yet — the server action adds it from the caller's own membership).
 */
import { z } from "zod";

export const inviteFormSchema = z.strictObject({
  displayName: z.string().trim().min(1, "required").max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  employeeCode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : undefined)),
  statute: z.enum(["bediende", "arbeider", "student", "flexi", "interim", "other"]),
  role: z.enum(["employee", "manager", "admin"]),
  siteIds: z.array(z.uuid()).min(1, "required"),
});

export type InviteFormInput = z.input<typeof inviteFormSchema>;
export type InviteFormValues = z.output<typeof inviteFormSchema>;

export interface InviteFormResult {
  readonly ok: boolean;
  readonly values: InviteFormValues | null;
  /** Field name -> first issue code, for inline errors. */
  readonly fieldErrors: Readonly<Record<string, string>>;
}

/**
 * Only owners and admins may invite `admin`/`manager`; a manager's choice is
 * restricted to `employee` here too, but the database has the final word.
 */
export function validateInviteForm(
  input: InviteFormInput,
  canInvitePrivilegedRoles: boolean,
): InviteFormResult {
  const parsed = inviteFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field] = issue.code === "invalid_type" ? "required" : issue.code;
      }
    }
    return { ok: false, values: null, fieldErrors };
  }

  if (!canInvitePrivilegedRoles && parsed.data.role !== "employee") {
    return {
      ok: false,
      values: null,
      fieldErrors: { role: "role_not_allowed" },
    };
  }

  return { ok: true, values: parsed.data, fieldErrors: {} };
}
