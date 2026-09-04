import { z } from "zod";
import { isUuid } from "@/lib/corrections/model";
import { timestamp } from "@/lib/time-clock/break-response";
import { exactMicroseconds } from "@/lib/time-clock/breaks";

export const uuid = z.string().refine(isUuid);
export const instant = z.string().refine(timestamp);
export const version = z.number().int().positive().max(2147483647);
export const kind = z.enum(["missed_break", "adjustment", "removal"]);
export const status = z.enum(["pending", "withdrawn", "approved", "rejected"]);
export const effectiveBreakSchema = z
  .object({
    logical_break_id: uuid,
    version,
    revision_id: uuid.nullable(),
    started_at: instant.nullable(),
    ended_at: instant.nullable(),
    removed: z.boolean(),
    origin: z.enum(["live", "approved_missed_break"]),
  })
  .strict()
  .refine((b) =>
    b.removed
      ? b.started_at === null && b.ended_at === null && b.revision_id !== null
      : b.started_at !== null &&
        b.ended_at !== null &&
        exactMicroseconds(b.ended_at) > exactMicroseconds(b.started_at),
  )
  .refine((b) => b.revision_id !== null || (b.origin === "live" && b.version === 2));
export type EffectiveBreak = z.infer<typeof effectiveBreakSchema>;
const entrySchema = z
  .object({
    id: uuid,
    organization_id: uuid,
    membership_id: uuid,
    worksite_id: uuid,
    started_at: instant,
    ended_at: instant,
    version,
    breaks: z.array(effectiveBreakSchema),
  })
  .strict()
  .refine((e) => {
    let end = exactMicroseconds(e.started_at);
    if (
      end >= exactMicroseconds(e.ended_at) ||
      new Set(e.breaks.map((b) => b.logical_break_id)).size !== e.breaks.length
    )
      return false;
    for (const b of e.breaks.filter((b) => !b.removed)) {
      if (
        exactMicroseconds(b.started_at!) < end ||
        exactMicroseconds(b.ended_at!) > exactMicroseconds(e.ended_at)
      )
        return false;
      end = exactMicroseconds(b.ended_at!);
    }
    return true;
  });
const requestSchema = z
  .object({
    id: uuid,
    organization_id: uuid,
    employee_membership_id: uuid,
    employee_display_name: z.string().nullable(),
    employee_code: z.string().nullable(),
    worksite_id: uuid,
    time_entry_id: uuid,
    logical_break_id: uuid,
    request_kind: kind,
    parent_version: version,
    parent_started_at: instant,
    parent_ended_at: instant,
    original_snapshot: effectiveBreakSchema.nullable(),
    current_snapshot: effectiveBreakSchema.nullable(),
    current_parent_started_at: instant,
    current_parent_ended_at: instant,
    current_parent_version: version,
    proposed_started_at: instant.nullable(),
    proposed_ended_at: instant.nullable(),
    employee_reason: z.string().trim().min(1).max(500),
    status,
    manager_note: z.string().min(1).max(500).nullable(),
    applied_revision_id: uuid.nullable(),
    created_at: instant,
    decided_at: instant.nullable(),
    stale: z.boolean(),
  })
  .strict()
  .refine(
    (r) =>
      (r.request_kind === "missed_break") === (r.original_snapshot === null) &&
      (r.request_kind === "removal"
        ? r.proposed_started_at === null && r.proposed_ended_at === null
        : r.proposed_started_at !== null &&
          r.proposed_ended_at !== null &&
          exactMicroseconds(r.proposed_started_at) <
            exactMicroseconds(r.proposed_ended_at) &&
          exactMicroseconds(r.proposed_started_at) >=
            exactMicroseconds(r.parent_started_at) &&
          exactMicroseconds(r.proposed_ended_at) <=
            exactMicroseconds(r.parent_ended_at)) &&
      (r.original_snapshot === null ||
        r.original_snapshot.logical_break_id === r.logical_break_id) &&
      (r.status === "pending") === (r.decided_at === null) &&
      (r.status === "approved") === (r.applied_revision_id !== null) &&
      (r.status !== "rejected" || r.manager_note !== null),
  );
const viewSchema = z
  .object({
    request_id: uuid,
    entries: z.array(entrySchema).max(20),
    requests: z.array(requestSchema),
  })
  .strict();
export type BreakView = z.infer<typeof viewSchema>;
export function parseBreakView(value: unknown, requestId: string): BreakView | null {
  const parsed = viewSchema.safeParse(value);
  return parsed.success && parsed.data.request_id === requestId ? parsed.data : null;
}
export const codes = [
  "submitted",
  "withdrawn",
  "approved",
  "rejected",
  "already_terminal",
  "closed_shift_required",
  "stale_request",
  "pending_time_correction",
  "pending_break_correction",
  "invalid_interval",
  "overlap",
  "unchanged",
  "unavailable",
] as const;
export type BreakCode = (typeof codes)[number];
export type BreakIntent = z.infer<typeof kind> | "withdraw" | "approve" | "reject";
const responseSchema = z
  .object({
    request_id: uuid,
    result_code: z.enum(codes),
    did_transition: z.boolean(),
    correction_request_id: uuid.nullable(),
    request_status: status.nullable(),
    applied_revision_id: uuid.nullable(),
  })
  .strict();
export function parseBreakCorrectionResponse(
  value: unknown,
  requestId: string,
  intent: BreakIntent,
  targetId?: string,
) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success || parsed.data.request_id !== requestId) return null;
  const r = parsed.data;
  const submission = ["missed_break", "adjustment", "removal"].includes(intent);
  const success = ["submitted", "withdrawn", "approved", "rejected"].includes(
    r.result_code,
  );
  if (
    r.did_transition !== success ||
    (r.request_status === "approved") !== (r.applied_revision_id !== null)
  )
    return null;
  if (submission) {
    if (
      ![
        "submitted",
        "closed_shift_required",
        "stale_request",
        "pending_time_correction",
        "pending_break_correction",
        "invalid_interval",
        "overlap",
        "unchanged",
      ].includes(r.result_code)
    )
      return null;
    if (
      r.result_code === "submitted"
        ? r.correction_request_id === null || r.request_status !== "pending"
        : r.correction_request_id !== null || r.request_status !== null
    )
      return null;
  } else {
    if (r.correction_request_id !== targetId) return null;
    if (r.result_code === "already_terminal") {
      if (r.request_status === null || r.request_status === "pending") return null;
    } else if (intent === "withdraw") {
      if (r.result_code !== "withdrawn" || r.request_status !== "withdrawn")
        return null;
    } else if (intent === "reject") {
      if (r.result_code !== "rejected" || r.request_status !== "rejected") return null;
    } else if (r.result_code === "approved") {
      if (r.request_status !== "approved") return null;
    } else if (
      ![
        "stale_request",
        "pending_time_correction",
        "invalid_interval",
        "overlap",
        "unavailable",
      ].includes(r.result_code) ||
      r.request_status !== "pending"
    )
      return null;
  }
  return r;
}
export type BreakActionState = {
  message: string;
  requestId?: string;
  code?: BreakCode;
};
export function retireOperation(current: string, completed?: string) {
  return completed === current ? "" : current;
}
