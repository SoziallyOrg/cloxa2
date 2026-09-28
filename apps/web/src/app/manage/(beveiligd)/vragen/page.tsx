import {
  brusselsDayKey,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
  type Shift,
} from "@cloxa/domain";
import {
  formatBrusselsLongDay,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import { ManageShell } from "@/components/manage/ManageShell";
import {
  RequestCard,
  type RequestCardChange,
  type RequestCardDay,
} from "@/components/manage/RequestCard";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedControl";
import type { StatusTone } from "@/components/ui/StatusLine";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import {
  buildCorrectionDiff,
  type CorrectionRequestLike,
} from "@/lib/manage/correction-diff";
import {
  positionPct,
  TIMELINE_AXIS_HOURS,
  TIMELINE_START_HOUR,
  timelineRow,
  timelineWindow,
  type TimelineWindow,
} from "@/lib/manage/timeline";
import { createClient } from "@/lib/supabase/server";

import { approveCorrectionAction, rejectCorrectionAction } from "./actions";

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

/** The shifts of one Brussels day, as a mini timeline and "08:02–16:30". */
function dayOf(
  shifts: readonly Shift[],
  dayKey: string,
  dayWindow: TimelineWindow,
  now: number,
): RequestCardDay {
  const onDay = shifts.filter((shift) => brusselsDayKey(shift.start) === dayKey);
  const summary =
    onDay.length === 0
      ? t("manageVragen.noShift")
      : onDay
          .map(
            (shift) =>
              `${formatBrusselsTime(new Date(shift.start))}–${
                shift.end !== null
                  ? formatBrusselsTime(new Date(shift.end))
                  : t("shifts.openEnd")
              }`,
          )
          .join(", ");
  return {
    track: timelineRow({ shifts: onDay, planned: [], now, window: dayWindow }),
    summary,
  };
}

export default async function ManageVragenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireManager();
  const supabase = await createClient();
  const now = nowMs();
  const params = await searchParams;
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = tabRaw === "decided" ? "decided" : "pending";
  const errorRaw = Array.isArray(params.error) ? params.error[0] : params.error;

  const { data: requestRows, error: requestsError } =
    tab === "pending"
      ? await supabase
          .from("correction_requests")
          .select(
            "id, employee_id, kind, status, target_event_ids, proposed, reason, decision_note, created_at, offline",
          )
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      : await supabase
          .from("correction_requests")
          .select(
            "id, employee_id, kind, status, target_event_ids, proposed, reason, decision_note, created_at, offline",
          )
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

  // One events window per request, around the day it touches. Pending lists
  // are small (at most 20 per employee by RPC rule), so this stays cheap.
  const diffs = await Promise.all(
    requests.map(async (request) => {
      const proposed = (request.proposed ?? {}) as {
        events?: readonly { occurred_at?: string; target_event_id?: string }[];
      };
      let anchorMs: number | null = null;
      if (request.kind === "add") {
        anchorMs = proposed.events?.[0]?.occurred_at
          ? Date.parse(proposed.events[0]!.occurred_at!)
          : null;
      } else if (request.target_event_ids.length > 0) {
        const { data: targetRows } = await supabase
          .from("clock_events")
          .select("occurred_at")
          .in("id", request.target_event_ids)
          .order("occurred_at", { ascending: true })
          .limit(1);
        anchorMs = targetRows?.[0] ? Date.parse(targetRows[0].occurred_at) : null;
      }
      anchorMs ??= Date.parse(request.created_at);

      const { data: windowRows, error: windowError } = await supabase
        .from("clock_events")
        .select(
          "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
        )
        .eq("employee_id", request.employee_id)
        .gte("occurred_at", new Date(anchorMs - DAY_MS).toISOString())
        .lte("occurred_at", new Date(anchorMs + DAY_MS).toISOString())
        .order("occurred_at");
      if (windowError) {
        throw new Error(`clock_events_unavailable:${windowError.code}`);
      }

      const requestLike: CorrectionRequestLike = {
        kind: request.kind as CorrectionRequestLike["kind"],
        targetEventIds: request.target_event_ids,
        proposed: proposed as CorrectionRequestLike["proposed"],
      };
      const diff = buildCorrectionDiff(requestLike, windowRows.map(toClockEvent));
      return { request, diff, anchorMs };
    }),
  );

  const errorKey =
    typeof errorRaw === "string" && errorRaw.startsWith("manage")
      ? (errorRaw as CatalogKey)
      : null;

  return (
    <ManageShell active="questions">
      <PageHeader title={t("manageVragen.heading")} />
      <SegmentedLinks
        label={t("manageVragen.decisionFilterLabel")}
        items={[
          {
            key: "pending",
            label: t("manageVragen.tabPending"),
            href: "/manage/vragen",
            current: tab === "pending",
          },
          {
            key: "decided",
            label: t("manageVragen.tabDecided"),
            href: "/manage/vragen?tab=decided",
            current: tab === "decided",
          },
        ]}
      />
      {errorKey ? <Alert tone="error">{t(errorKey)}</Alert> : null}

      {diffs.length === 0 ? (
        <EmptyState
          title={
            tab === "pending" ? t("manageVragen.empty") : t("manageVragen.emptyDecided")
          }
          body={
            tab === "pending"
              ? t("manageVragen.emptyBody")
              : t("manageVragen.emptyDecidedBody")
          }
        />
      ) : (
        <ul className="flex flex-col gap-6">
          {diffs.map(({ request, diff, anchorMs }) => {
            const changes: RequestCardChange[] = diff.changes.map((change) => ({
              typeLabel: t(EVENT_TYPE_LABEL_KEY[change.type] ?? "manageVragen.kindAdd"),
              beforeLabel: change.beforeIso
                ? formatBrusselsTime(new Date(change.beforeIso))
                : null,
              afterLabel: change.afterIso
                ? formatBrusselsTime(new Date(change.afterIso))
                : null,
            }));
            const dayKey = brusselsDayKey(anchorMs);
            const dayWindow = timelineWindow(dayKey);
            const axis = TIMELINE_AXIS_HOURS.map(
              (hour) =>
                [
                  hour,
                  positionPct(
                    dayWindow.start + (hour - TIMELINE_START_HOUR) * 3600 * 1000,
                    dayWindow,
                  ),
                ] as const,
            );

            return (
              <RequestCard
                key={request.id}
                id={request.id}
                employeeName={employeeNames.get(request.employee_id) ?? "?"}
                dateLabel={formatBrusselsLongDay(new Date(anchorMs))}
                kindLabel={
                  // Queued offline and did not fit: say so, not "vergeten".
                  request.offline
                    ? t("offline.requestLabel")
                    : t(KIND_LABEL_KEY[request.kind] ?? "manageVragen.kindAdd")
                }
                changes={changes}
                before={dayOf(diff.beforeShifts, dayKey, dayWindow, now)}
                after={dayOf(diff.afterShifts, dayKey, dayWindow, now)}
                axis={axis}
                reason={request.reason}
                {...(tab === "pending"
                  ? {
                      approveAction: approveCorrectionAction,
                      rejectAction: rejectCorrectionAction,
                    }
                  : {
                      decision: {
                        tone: DECISION_TONE[request.status] ?? "off",
                        statusLabel:
                          request.status === "approved"
                            ? t("manageVragen.decisionApproved")
                            : t("manageVragen.decisionRejected"),
                        note: request.decision_note,
                      },
                    })}
              />
            );
          })}
        </ul>
      )}
    </ManageShell>
  );
}
