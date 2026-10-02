import {
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import {
  formatBrusselsLongDay,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import type { StatusTone } from "@/components/ui/StatusLine";
import type { createClient } from "@/lib/supabase/server";

import { eventsInWindow, earliestTargetMs, windowsByEmployee } from "./request-batch";
import { buildCorrectionDiff, type CorrectionRequestLike } from "./correction-diff";
import { requestTiles } from "./today-board";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const KIND_LABEL_KEY: Record<string, CatalogKey> = {
  add: "manageVragen.kindAdd",
  adjust: "manageVragen.kindAdjust",
  remove: "manageVragen.kindRemove",
};

const EVENT_TYPE_LABEL_KEY: Record<string, CatalogKey> = {
  clock_in: "manageVragen.eventTypeClockIn",
  clock_out: "manageVragen.eventTypeClockOut",
  break_start: "manageVragen.eventTypeBreakStart",
  break_end: "manageVragen.eventTypeBreakEnd",
};

const DECISION_TONE: Record<string, StatusTone> = {
  approved: "working",
  rejected: "danger",
};

const DAY_MS = 24 * 3600 * 1000;
/** Ids per `in(...)` query: keeps the request URL short. */
const ID_CHUNK = 100;

/** One correction request, fully worded: the board only has to draw it. */
export interface RequestModel {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  /** "vrijdag 2 oktober". */
  readonly dayLabel: string;
  /** What was asked, in plain Dutch: "Vergeten in te klokken". */
  readonly kindLabel: string;
  /** Queued offline and too late to fit: shown as a small tag. */
  readonly offline: boolean;
  /** "Starttijd, Eindtijd": what the request touches. */
  readonly touches: string;
  /** The times before and after; `null` = nothing there. */
  readonly was: string | null;
  readonly wordt: string | null;
  readonly resultingShiftLabel: string | null;
  /** Null once the requester was anonymised (ADR 007). */
  readonly reason: string | null;
  /** Present for "Behandeld"; absent (open) shows the decide buttons. */
  readonly decision?: {
    readonly tone: StatusTone;
    readonly statusLabel: string;
    readonly note: string | null;
  };
}

interface CorrectionRow {
  id: string;
  employee_id: string;
  kind: string;
  offline: boolean;
  status: string;
  target_event_ids: string[];
  proposed: unknown;
  reason: string | null;
  decision_note: string | null;
  created_at: string;
}

function toClockEvent(row: {
  id: string;
  type: string;
  occurred_at: string;
  employee_id: string;
  site_id: string;
  source: string;
  supersedes_event_id: string | null;
  correction_id: string | null;
}): ClockEvent {
  return {
    id: row.id,
    type: row.type as ClockEventType,
    occurredAt: Date.parse(row.occurred_at),
    employeeId: row.employee_id,
    siteId: row.site_id,
    source: row.source as ClockEventSource,
    ...(row.supersedes_event_id ? { supersedesEventId: row.supersedes_event_id } : {}),
    ...(row.correction_id ? { correctionId: row.correction_id } : {}),
  };
}

const COLUMNS =
  "id, employee_id, kind, status, target_event_ids, proposed, reason, decision_note, created_at, offline";

/**
 * Open requests (oldest first) or the last 30 decided ones, each replayed
 * against the employee's events so the manager sees was and wordt. RLS-scoped
 * reads only; the decisions themselves stay in `vragen/actions.ts`.
 */
export async function loadRequests(
  supabase: Supabase,
  tab: "pending" | "decided",
  options: { limit?: number } = {},
): Promise<RequestModel[]> {
  const { data: requestRows, error: requestsError } =
    tab === "pending"
      ? await supabase
          .from("correction_requests")
          .select(COLUMNS)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(options.limit ?? 1000)
      : await supabase
          .from("correction_requests")
          .select(COLUMNS)
          .in("status", ["approved", "rejected"])
          .order("decided_at", { ascending: false })
          .limit(30);
  if (requestsError) {
    throw new Error(`correction_requests_unavailable:${requestsError.code}`);
  }
  const requests = requestRows as CorrectionRow[];

  const employeeIds = [...new Set(requests.map((request) => request.employee_id))];
  const { data: employeeRows, error: employeesError } =
    employeeIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("employees")
          .select("id, display_name")
          .in("id", employeeIds);
  if (employeesError) throw new Error(`employees_unavailable:${employeesError.code}`);
  const employeeNames = new Map(
    employeeRows.map((employee) => [employee.id, employee.display_name]),
  );

  // Batched: one query for every target, then one events window per employee
  // (the span of that employee's requests); each request filters its own
  // ±1 day out of that in memory.
  const proposedOf = (request: CorrectionRow) =>
    (request.proposed ?? {}) as {
      events?: readonly { occurred_at?: string; target_event_id?: string }[];
    };
  const targetIds = [
    ...new Set(
      requests
        .filter((request) => request.kind !== "add")
        .flatMap((request) => request.target_event_ids),
    ),
  ];
  const targetTimes = new Map<string, string>();
  for (let i = 0; i < targetIds.length; i += ID_CHUNK) {
    const { data: targetRows } = await supabase
      .from("clock_events")
      .select("id, occurred_at")
      .in("id", targetIds.slice(i, i + ID_CHUNK));
    for (const row of targetRows ?? []) targetTimes.set(row.id, row.occurred_at);
  }

  const anchors = requests.map((request) => {
    const proposed = proposedOf(request);
    let anchorMs: number | null = null;
    if (request.kind === "add") {
      anchorMs = proposed.events?.[0]?.occurred_at
        ? Date.parse(proposed.events[0]!.occurred_at!)
        : null;
    } else if (request.target_event_ids.length > 0) {
      anchorMs = earliestTargetMs(request.target_event_ids, targetTimes);
    }
    return anchorMs ?? Date.parse(request.created_at);
  });

  const spans = windowsByEmployee(
    requests.map((request, index) => ({
      id: request.id,
      employeeId: request.employee_id,
      anchorMs: anchors[index]!,
    })),
  );
  const windowResults = await Promise.all(
    [...spans].map(async ([employeeId, span]) => {
      const { data, error } = await supabase
        .from("clock_events")
        .select(
          "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
        )
        .eq("employee_id", employeeId)
        .gte("occurred_at", new Date(span.fromMs).toISOString())
        .lte("occurred_at", new Date(span.toMs).toISOString())
        .order("occurred_at");
      if (error) throw new Error(`clock_events_unavailable:${error.code}`);
      return data;
    }),
  );
  const windowEvents = windowResults.flat();

  return requests.map((request, index): RequestModel => {
    const proposed = proposedOf(request);
    const anchor = anchors[index]!;
    const windowRows = eventsInWindow(windowEvents, {
      employeeId: request.employee_id,
      anchorMs: anchor,
    });

    const requestLike: CorrectionRequestLike = {
      kind: request.kind as CorrectionRequestLike["kind"],
      targetEventIds: request.target_event_ids,
      proposed: proposed as CorrectionRequestLike["proposed"],
    };
    const diff = buildCorrectionDiff(requestLike, windowRows.map(toClockEvent));

    const changes = diff.changes.map((change) => ({
      typeLabel: t(EVENT_TYPE_LABEL_KEY[change.type] ?? "manageVragen.kindAdd"),
      beforeLabel: change.beforeIso
        ? formatBrusselsTime(new Date(change.beforeIso))
        : null,
      afterLabel: change.afterIso
        ? formatBrusselsTime(new Date(change.afterIso))
        : null,
    }));
    const tiles = requestTiles(changes);
    const resultingShift = diff.afterShifts.find(
      (shift) =>
        Math.abs(shift.start - anchor) < DAY_MS ||
        (shift.end !== null && Math.abs(shift.end - anchor) < DAY_MS),
    );

    const model: RequestModel = {
      id: request.id,
      employeeId: request.employee_id,
      employeeName: employeeNames.get(request.employee_id) ?? "?",
      dayLabel: formatBrusselsLongDay(new Date(anchor)),
      kindLabel: request.offline
        ? // Queued offline and did not fit: say so, not "vergeten".
          t("offline.requestLabel")
        : t(KIND_LABEL_KEY[request.kind] ?? "manageVragen.kindAdd"),
      offline: request.offline,
      touches: [...new Set(changes.map((change) => change.typeLabel))].join(", "),
      was: tiles.was,
      wordt: tiles.wordt,
      resultingShiftLabel: resultingShift
        ? `${formatBrusselsTime(new Date(resultingShift.start))}–${resultingShift.end ? formatBrusselsTime(new Date(resultingShift.end)) : t("shifts.openEnd")}`
        : null,
      reason: request.reason,
    };
    return tab === "pending"
      ? model
      : {
          ...model,
          decision: {
            tone: DECISION_TONE[request.status] ?? "off",
            statusLabel:
              request.status === "approved"
                ? t("manageVragen.decisionApproved")
                : t("manageVragen.decisionRejected"),
            note: request.decision_note,
          },
        };
  });
}
