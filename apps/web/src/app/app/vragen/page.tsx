import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { formatBrusselsDate, formatBrusselsShortDate, t } from "@cloxa/i18n";

import { AccountButton } from "@/components/employee/Account";
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
    .select("id, kind, status, reason, decision_note, created_at")
    .eq("employee_id", context.employeeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`correction_requests_unavailable:${error.code}`);

  const rows: RequestRow[] = requests.map((request) => {
    const key = statusKey(request.status);
    const kind =
      request.kind in KIND_LABEL_KEY
        ? KIND_LABEL_KEY[request.kind as keyof typeof KIND_LABEL_KEY]
        : null;
    const date = formatBrusselsDate(new Date(request.created_at));
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
    };
  });

  const newRequest = (
    <Link
      href="/app/vragen/nieuw"
      transitionTypes={PUSH}
      className={buttonClassName("primary", "lg")}
    >
      {t("questions.newRequest")}
    </Link>
  );

  return (
    <PageTransition className="flex flex-1 flex-col">
      <PullToRefresh className="flex flex-1 flex-col">
        <NavBar
          title={t("questions.heading")}
          trailing={<AccountButton placement="bar" />}
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
            <div className="sticky bottom-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom))] mt-auto bg-grouped/85 px-inset pt-2 pb-4 backdrop-blur-md md:static md:mt-0 md:bg-transparent md:pb-10 md:backdrop-blur-none">
              {newRequest}
            </div>
          </>
        )}
      </PullToRefresh>
    </PageTransition>
  );
}
