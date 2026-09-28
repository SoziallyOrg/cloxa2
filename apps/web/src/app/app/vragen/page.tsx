import Link from "next/link";

import { formatBrusselsDate, t } from "@cloxa/i18n";

import { Button, buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupedList, ListRow } from "@/components/ui/GroupedList";
import { StatusLine, type StatusTone } from "@/components/ui/StatusLine";
import { requireEmployeeArea } from "@/lib/auth/context";
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
  const supabase = await createClient();

  const { data: requests, error } = await supabase
    .from("correction_requests")
    .select("id, kind, status, reason, decision_note, created_at")
    .eq("employee_id", context.employeeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`correction_requests_unavailable:${error.code}`);

  return (
    <div className="flex flex-1 flex-col gap-8 pt-6 md:pt-0">
      <h1 className="text-title">{t("questions.heading")}</h1>

      {requests.length === 0 ? (
        <EmptyState title={t("questions.empty")} body={t("questions.emptyBody")} />
      ) : (
        <GroupedList>
          {requests.map((request) => {
            const key = statusKey(request.status);
            const kind =
              request.kind in KIND_LABEL_KEY
                ? KIND_LABEL_KEY[request.kind as keyof typeof KIND_LABEL_KEY]
                : null;
            return (
              <ListRow
                key={request.id}
                title={
                  kind ? t(kind) : formatBrusselsDate(new Date(request.created_at))
                }
                detail={
                  <span className="flex flex-col gap-1.5 pt-0.5">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusLine
                        tone={STATUS_TONE[key]}
                        label={t(STATUS_LABEL_KEY[key])}
                        size="sm"
                      />
                      <span>{formatBrusselsDate(new Date(request.created_at))}</span>
                    </span>
                    {request.reason ? (
                      <span className="text-body text-ink">{request.reason}</span>
                    ) : null}
                    {request.decision_note ? (
                      <span>
                        {t("questions.managerNote", { note: request.decision_note })}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {request.status === "pending" ? (
                  <form action={withdrawCorrectionAction}>
                    <input type="hidden" name="id" value={request.id} />
                    <Button type="submit" variant="plain">
                      {t("questions.withdraw")}
                    </Button>
                  </form>
                ) : null}
              </ListRow>
            );
          })}
        </GroupedList>
      )}

      <div className="sticky bottom-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom)+1rem)] mt-auto bg-paper pt-2 md:static md:mt-0">
        <Link href="/app/vragen/nieuw" className={buttonClassName("primary", "lg")}>
          {t("questions.newRequest")}
        </Link>
      </div>
    </div>
  );
}
