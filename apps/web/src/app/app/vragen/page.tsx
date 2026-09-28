import Link from "next/link";

import { formatBrusselsDate, t } from "@cloxa/i18n";

import { AppShell } from "@/components/employee/AppShell";
import { Button, buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Stack } from "@/components/ui/Stack";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
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
  rejected: "error",
  withdrawn: "off",
};

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
    <AppShell active="questions">
      <div className="flex items-center justify-between gap-3">
        <Heading level={1}>{t("questions.heading")}</Heading>
        <Link href="/app/vragen/nieuw" className={buttonClassName("primary", "md")}>
          {t("questions.newRequest")}
        </Link>
      </div>

      {requests.length === 0 ? (
        <EmptyState title={t("questions.empty")} body={t("questions.emptyBody")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => {
            const key = statusKey(request.status);
            return (
              <li
                key={request.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <Stack row gap="sm" className="justify-between">
                  <span className="font-semibold">
                    {formatBrusselsDate(new Date(request.created_at))}
                  </span>
                  <StatusBadge
                    tone={STATUS_TONE[key]}
                    label={t(STATUS_LABEL_KEY[key])}
                  />
                </Stack>
                <p className="text-ink/70">{request.reason}</p>
                {request.decision_note ? (
                  <p className="text-ink/70">
                    {t("questions.managerNote", { note: request.decision_note })}
                  </p>
                ) : null}
                {request.status === "pending" ? (
                  <form action={withdrawCorrectionAction}>
                    <input type="hidden" name="id" value={request.id} />
                    <Button type="submit" variant="quiet" size="md">
                      {t("questions.withdraw")}
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
