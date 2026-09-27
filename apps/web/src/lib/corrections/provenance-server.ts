import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { getBreakCorrections } from "@/lib/break-corrections/server";
import { exactMicroseconds } from "@/lib/time-clock/breaks";
import { appliedDecision, type Provenance } from "./provenance";

/** Existing authenticated SELECT grants + RLS only; no elevated client or new RPC. */
export async function getEmployeeProvenance(
  entries: { id: string; startedAt: string; endedAt: string | null }[],
): Promise<Provenance | null> {
  if (!entries.length) return {};
  if (entries.length > 20) return null;
  try {
    const client = await createSupabaseServerClient();
    const auth = await getAuthContext(client);
    if (auth.state !== "authorized" || auth.role !== "employee") return null;
    const [facts, breaks] = await Promise.all([
      client
        .from("time_entries")
        .select("id,started_at,ended_at,origin,last_correction_request_id")
        .in(
          "id",
          entries.map((e) => e.id),
        ),
      getBreakCorrections(client),
    ]);
    if (facts.error || !facts.data || !breaks) return null;
    const timeIds = facts.data.flatMap((e) =>
      e.last_correction_request_id ? [e.last_correction_request_id] : [],
    );
    const revisions = breaks.entries
      .filter((e) => entries.some((input) => input.id === e.id))
      .flatMap((e) =>
        e.breaks
          .filter((b) => b.revision_id)
          .map((b) => ({ entryId: e.id, revisionId: b.revision_id! })),
      );
    if (revisions.length > 200) return null;
    const [timeRequests, breakRequests] = await Promise.all([
      timeIds.length
        ? client
            .from("correction_requests")
            .select(
              "id,status,request_kind,applied_time_entry_id,proposed_started_at,proposed_ended_at,employee_reason,manager_note",
            )
            .in("id", timeIds)
        : { data: [], error: null },
      revisions.length
        ? client
            .from("break_correction_requests")
            .select(
              "id,status,request_kind,applied_revision_id,proposed_started_at,proposed_ended_at,employee_reason,manager_note",
            )
            .in(
              "applied_revision_id",
              revisions.map((r) => r.revisionId),
            )
        : { data: [], error: null },
    ]);
    if (timeRequests.error || breakRequests.error) return null;
    const result: Provenance = {};
    for (const input of entries) {
      const fact = facts.data.find((e) => e.id === input.id);
      if (
        !fact ||
        exactMicroseconds(fact.started_at) !== exactMicroseconds(input.startedAt) ||
        (fact.ended_at === null) !== (input.endedAt === null) ||
        (fact.ended_at &&
          input.endedAt &&
          exactMicroseconds(fact.ended_at) !== exactMicroseconds(input.endedAt))
      )
        continue;
      const decisions = [];
      if (fact.last_correction_request_id) {
        const proof = appliedDecision(
          timeRequests.data?.find((r) => r.id === fact.last_correction_request_id),
          { id: fact.last_correction_request_id, appliedId: fact.id, category: "time" },
        );
        if (proof) decisions.push(proof);
      }
      for (const revision of revisions.filter((r) => r.entryId === input.id)) {
        const request = breakRequests.data?.find(
          (r) => r.applied_revision_id === revision.revisionId,
        );
        if (!request) continue;
        const proof = appliedDecision(request, {
          id: request.id,
          appliedId: revision.revisionId,
          category: "break",
        });
        if (proof) decisions.push(proof);
      }
      result[input.id] = { added: fact.origin === "approved_missed_entry", decisions };
    }
    return result;
  } catch {
    return null;
  }
}
