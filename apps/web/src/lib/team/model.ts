import { z } from "zod";
import { isTimestamp } from "@/lib/corrections/model";

export const teamUuid = z.uuid();
const timestamp = z.string().refine(isTimestamp);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const membershipStatus = z.enum(["active", "suspended", "invited", "inactive"]);
const blockers = {
  has_open_shift: z.boolean(),
  has_open_break: z.boolean(),
  pending_time_correction_count: count,
  pending_break_correction_count: count,
};
const settings = {
  organization_id: teamUuid,
  organization_name: text,
  worksite_id: teamUuid,
  worksite_name: text,
  timezone: z.literal("Europe/Brussels"),
};
export const employeeSchema = z.strictObject({
  membership_id: teamUuid,
  display_name: text.nullable(),
  employee_code: text.nullable(),
  account_email: z.email().nullable(),
  membership_status: membershipStatus,
  created_at: timestamp,
  activated_at: timestamp.nullable(),
  ...blockers,
});
const invitationSchema = z
  .strictObject({
    email: z.email(),
    status: z.enum(["pending", "accepted", "expired", "revoked"]),
    created_at: timestamp,
    expires_at: timestamp,
    accepted_at: timestamp.nullable(),
    revoked_at: timestamp.nullable(),
  })
  .refine(
    (v) =>
      (v.status === "accepted") === (v.accepted_at !== null) &&
      (v.status === "revoked") === (v.revoked_at !== null),
  );
export const teamSchema = z
  .strictObject({
    request_id: teamUuid,
    ...settings,
    employees: z.array(employeeSchema).max(100),
    invitations: z.array(invitationSchema).max(100),
  })
  .refine(
    (v) => new Set(v.employees.map((e) => e.membership_id)).size === v.employees.length,
  );
export type TeamView = z.infer<typeof teamSchema>;
export type TeamEmployee = z.infer<typeof employeeSchema>;

// PostgreSQL btrim(text) strips ASCII spaces; length(text) counts Unicode code points.
export const trimTeamValue = (value: string) => value.replace(/^ +| +$/gu, "");
const boundedName = (max: number) =>
  z
    .string()
    .transform(trimTeamValue)
    .refine(
      (v) =>
        Array.from(v).length >= 1 && Array.from(v).length <= max && !/\p{Cc}/u.test(v),
    );
const code = z
  .string()
  .transform(trimTeamValue)
  .transform((v) => v || null)
  .refine((v) => v === null || (Array.from(v).length <= 32 && !/\p{Cc}/u.test(v)));
export const teamInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("update_profile"),
    request_id: teamUuid,
    target_membership_id: teamUuid,
    display_name: boundedName(100),
    employee_code: code,
  }),
  z.strictObject({
    action: z.literal("suspend"),
    request_id: teamUuid,
    target_membership_id: teamUuid,
    confirmed: z.boolean(),
  }),
  z.strictObject({
    action: z.literal("reactivate"),
    request_id: teamUuid,
    target_membership_id: teamUuid,
    confirmed: z.boolean(),
  }),
  z.strictObject({
    action: z.literal("update_settings"),
    request_id: teamUuid,
    organization_name: boundedName(120),
    worksite_name: boundedName(120),
  }),
]);
export type TeamInput = z.output<typeof teamInputSchema>;
export type TeamRawInput = z.input<typeof teamInputSchema>;

const base = { request_id: teamUuid, did_change: z.boolean() };
export const profileResultSchema = z
  .strictObject({
    ...base,
    result_code: z.enum(["updated", "unchanged", "duplicate_employee_code"]),
    target_membership_id: teamUuid,
    display_name: text,
    employee_code: text.nullable(),
  })
  .refine((v) => v.did_change === (v.result_code === "updated"));
export const statusResultSchema = z
  .strictObject({
    ...base,
    result_code: z.enum([
      "suspended",
      "reactivated",
      "already_suspended",
      "already_active",
      "confirmation_required",
      "unavailable",
      "open_shift",
      "open_break",
      "ambiguous_membership",
    ]),
    target_membership_id: teamUuid,
    membership_status: membershipStatus,
    ...blockers,
  })
  .refine((v) => v.did_change === ["suspended", "reactivated"].includes(v.result_code));
export const settingsResultSchema = z
  .strictObject({
    ...base,
    ...settings,
    result_code: z.enum(["updated", "unchanged"]),
  })
  .refine((v) => v.did_change === (v.result_code === "updated"));
export type TeamResult =
  | z.infer<typeof profileResultSchema>
  | z.infer<typeof statusResultSchema>
  | z.infer<typeof settingsResultSchema>;

export function parseTeam(
  value: unknown,
  requestId: string,
  organizationId: string,
): TeamView | null {
  const result = teamSchema.safeParse(value);
  return result.success &&
    result.data.request_id === requestId &&
    result.data.organization_id === organizationId
    ? result.data
    : null;
}

export function parseTeamResult(
  value: unknown,
  input: TeamInput,
  context: Pick<TeamView, "organization_id" | "worksite_id">,
): TeamResult | null {
  if (input.action === "update_settings") {
    const p = settingsResultSchema.safeParse(value);
    if (!p.success) return null;
    const v = p.data;
    return v.request_id === input.request_id &&
      v.organization_id === context.organization_id &&
      v.worksite_id === context.worksite_id &&
      v.organization_name === input.organization_name &&
      v.worksite_name === input.worksite_name
      ? v
      : null;
  }
  if (input.action === "update_profile") {
    const p = profileResultSchema.safeParse(value);
    if (!p.success) return null;
    const v = p.data;
    return v.request_id === input.request_id &&
      v.target_membership_id === input.target_membership_id &&
      (v.result_code === "duplicate_employee_code" ||
        (v.display_name === input.display_name &&
          v.employee_code === input.employee_code))
      ? v
      : null;
  }
  const p = statusResultSchema.safeParse(value);
  if (!p.success) return null;
  const v = p.data;
  if (
    v.request_id !== input.request_id ||
    v.target_membership_id !== input.target_membership_id
  )
    return null;
  if (!input.confirmed) return v.result_code === "confirmation_required" ? v : null;
  if (v.result_code === "confirmation_required") return null;
  const suspend = input.action === "suspend";
  switch (v.result_code) {
    case "suspended":
      return suspend &&
        v.membership_status === "suspended" &&
        !v.has_open_shift &&
        !v.has_open_break
        ? v
        : null;
    case "already_suspended":
      return suspend && v.membership_status === "suspended" ? v : null;
    case "reactivated":
    case "already_active":
      return !suspend && v.membership_status === "active" ? v : null;
    case "open_shift":
      return suspend &&
        v.membership_status === "active" &&
        v.has_open_shift &&
        !v.has_open_break
        ? v
        : null;
    case "open_break":
      return suspend && v.membership_status === "active" && v.has_open_break ? v : null;
    case "ambiguous_membership":
      return !suspend && v.membership_status === "suspended" ? v : null;
    case "unavailable":
      return v.membership_status === "inactive" || v.membership_status === "invited"
        ? v
        : null;
  }
}

export const teamResultCopy: Record<TeamResult["result_code"], string> = {
  updated: "Wijzigingen opgeslagen.",
  unchanged: "Geen wijzigingen nodig.",
  duplicate_employee_code:
    "Deze personeelscode is al in gebruik. Kies een andere code.",
  suspended: "Toegang geschorst. Historische gegevens blijven bewaard.",
  reactivated: "Toegang hersteld voor hetzelfde lidmaatschap.",
  already_suspended: "Deze medewerker is al geschorst.",
  already_active: "Deze medewerker heeft al actieve toegang.",
  confirmation_required: "Bevestig de wijziging van toegang.",
  unavailable: "Dit lidmaatschap kan niet worden gewijzigd.",
  open_shift: "Schorsen kan niet: deze medewerker heeft een open dienst.",
  open_break: "Schorsen kan niet: deze medewerker heeft een open pauze.",
  ambiguous_membership: "Heractiveren kan niet: er bestaat al een actief lidmaatschap.",
};
export const teamFailure =
  "Geen bevestiging ontvangen. Probeer dezelfde wijziging opnieuw.";
export type TeamActionState = {
  result?: TeamResult;
  message: string;
  fieldErrors?: Record<string, string>;
};
