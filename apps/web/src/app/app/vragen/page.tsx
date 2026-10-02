import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { formatBrusselsDate, formatBrusselsShortDate, t } from "@cloxa/i18n";

import {
  requestChanges,
  type TargetEvent,
} from "@/components/employee/request-changes";
import { RequestsList, type RequestRow } from "@/components/employee/RequestsList";
import { buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { List } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import type { StatusTone } from "@/components/ui/StatusLine";
import { PUSH } from "@/components/ui/transitions";
import { requireEmployeeArea } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { withdrawCorrectionAction } from "./actions";

const STATUS_LABEL_KEY = {
  pending: "questions.statusPending",
  approved: "questions.statusApproved",
  rejected: "questions.statusRejected",
  withdrawn: "questions.statusWithdrawn",
} as const;

const STATUS_TONE: Record<keyof typeof STATUS_LABEL_KEY, StatusTone> = {
  pending: "break",
  approved: "working",
  rejected: "danger",
  withdrawn: "off",
};

const KIND_LABEL_KEY = {
  add: "correctionForm.kindAdd",
  adjust: "correctionForm.kindAdjust",
  remove: "correctionForm.kindRemove",
} as const;

function statusKey(status: string): keyof typeof STATUS_LABEL_KEY {
  return status in STATUS_LABEL_KEY
    ? (status as keyof typeof STATUS_LABEL_KEY)
    : "pending";
}

export default async function QuestionsPage() {
  const context = await requireEmployeeArea();
  await previewHold();
  const supabase = await createClient();

  const { data: requests, error } = await supabase
    .from("correction_requests")
    .select(
      "id, kind, status, reason, decision_note, created_at, proposed, target_event_ids",
    )
    .eq("employee_id", context.employeeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`correction_requests_unavailable:${error.code}`);

  // The registrations the requests point at, so "Was" can show the old time (own rows, under RLS).
  const targetIds = [
    ...new Set(requests.flatMap((request) => request.target_event_ids)),
  ];
  const { data: targetRows, error: targetsError } =
    targetIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("clock_events")
          .select("id, type, occurred_at")
          .in("id", targetIds);
  if (targetsError) throw new Error(`clock_events_unavailable:${targetsError.code}`);
  const targetEvents: TargetEvent[] = targetRows.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
  }));

  const rows: RequestRow[] = requests.map((request) => {
    const key = statusKey(request.status);
    const kind =
      request.kind in KIND_LABEL_KEY
        ? KIND_LABEL_KEY[request.kind as keyof typeof KIND_LABEL_KEY]
        : null;
    const date = formatBrusselsDate(new Date(request.created_at));
    const { changes, dayLabel } = requestChanges({
      kind: request.kind,
      proposed: request.proposed,
      targetEventIds: request.target_event_ids,
      targetEvents,
    });
    return {
      id: request.id,
      title: kind ? t(kind) : date,
      date,
      shortDate: formatBrusselsShortDate(new Date(request.created_at)),
      statusLabel: t(STATUS_LABEL_KEY[key]),
      statusTone: STATUS_TONE[key],
      pending: request.status === "pending",
      reason: request.reason || null,
      managerNote: request.decision_note || null,
      changes,
      dayLabel,
    };
  });

  const newRequest = (
    <Link
      href="/app/vragen/nieuw"
      transitionTypes={PUSH}
      className={buttonClassName("primary", "md", true)}
    >
      {t("questions.newRequest")}
    </Link>
  );

  return (
    <PageTransition className="flex flex-1 flex-col">
      <PullToRefresh className="flex flex-1 flex-col">
        <NavBar
          title={t("questions.heading")}
          trailing={
            rows.length > 0 ? (
              <span className="hidden md:inline-flex">
                <Link
                  href="/app/vragen/nieuw"
                  transitionTypes={PUSH}
                  className={buttonClassName("primary", "md")}
                >
                  {t("questions.newRequest")}
                </Link>
              </span>
            ) : null
          }
        />
        {rows.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center pb-10">
            <EmptyState
              icon={MessageSquare}
              title={t("questions.empty")}
              body={t("questions.emptyBody")}
              action={newRequest}
            />
          </div>
        ) : (
          <>
            <List className="pb-6">
              <RequestsList rows={rows} withdrawAction={withdrawCorrectionAction} />
            </List>
            <div className="sticky bottom-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom))] mt-auto bg-paper px-gutter pt-2 pb-4 md:hidden">
              {newRequest}
            </div>
          </>
        )}
      </PullToRefresh>
    </PageTransition>
  );
}
