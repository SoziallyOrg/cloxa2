import { z } from "zod";
import { validTimestamp } from "@/lib/time-clock/breaks";

const decision = z.object({
  id: z.uuid(),
  status: z.literal("approved"),
  request_kind: z.enum(["adjustment", "missed_entry", "missed_break", "removal"]),
  proposed_started_at: z.string().refine(validTimestamp).nullable(),
  proposed_ended_at: z.string().refine(validTimestamp).nullable(),
  employee_reason: z.string(),
  manager_note: z.string().nullable(),
});
export type AppliedDecision = {
  id: string;
  category: "time" | "break";
  kind: string;
  startedAt: string | null;
  endedAt: string | null;
  reason: string;
  note: string | null;
};
export type EntryProvenance = { added: boolean; decisions: AppliedDecision[] };
export type Provenance = Record<string, EntryProvenance>;

/** Positive application evidence only: approved request AND matching factual pointer. */
export function appliedDecision(
  raw: unknown,
  pointer: { id: string; appliedId: string; category: "time" | "break" },
): AppliedDecision | null {
  const parsed = decision
    .extend(
      pointer.category === "time"
        ? { applied_time_entry_id: z.literal(pointer.appliedId) }
        : { applied_revision_id: z.literal(pointer.appliedId) },
    )
    .safeParse(raw);
  if (!parsed.success || parsed.data.id !== pointer.id) return null;
  const p = parsed.data;
  if (
    pointer.category === "time" &&
    !["adjustment", "missed_entry"].includes(p.request_kind)
  )
    return null;
  if (pointer.category === "break" && p.request_kind === "missed_entry") return null;
  if (p.request_kind !== "removal" && (!p.proposed_started_at || !p.proposed_ended_at))
    return null;
  return {
    id: p.id,
    category: pointer.category,
    kind: p.request_kind,
    startedAt: p.proposed_started_at,
    endedAt: p.proposed_ended_at,
    reason: p.employee_reason,
    note: p.manager_note,
  };
}
