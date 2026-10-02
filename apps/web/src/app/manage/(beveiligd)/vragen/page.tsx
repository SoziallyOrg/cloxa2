import { CircleCheck, Inbox } from "lucide-react";

import { t } from "@cloxa/i18n";

import { RequestsBoard } from "@/components/manage/RequestsBoard";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavBar } from "@/components/ui/NavBar";
import { Notice } from "@/components/ui/Notice";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SegmentNav } from "@/components/ui/SegmentNav";
import { requireManager } from "@/lib/auth/context";
import { decideErrorKey } from "@/lib/manage/errors";
import { loadRequests } from "@/lib/manage/requests";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { approveCorrectionAction, rejectCorrectionAction } from "./actions";

export default async function ManageVragenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireManager();
  await previewHold();
  const supabase = await createClient();
  const params = await searchParams;
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = tabRaw === "decided" ? "decided" : "pending";
  const errorRaw = Array.isArray(params.error) ? params.error[0] : params.error;

  const requests = await loadRequests(supabase, tab);

  const errorKey = decideErrorKey(errorRaw);

  const tabs = [
    { value: "pending", label: t("manageVragen.tabOpen"), href: "/manage/vragen" },
    {
      value: "decided",
      label: t("manageVragen.tabDecided"),
      href: "/manage/vragen?tab=decided",
    },
  ] as const;

  return (
    <PageTransition>
      <PullToRefresh>
        <NavBar title={t("manageVragen.heading")} />
        <div className="flex flex-col gap-5 px-gutter pb-10 md:px-gutter-desktop">
          <div className="max-w-readable">
            <SegmentNav
              key={tab}
              label={t("manageVragen.tabsLabel")}
              options={tabs}
              value={tab}
            />
          </div>
          {errorKey ? <Notice tone="error">{t(errorKey)}</Notice> : null}

          {requests.length === 0 ? (
            <div className="rounded-card bg-card shadow-card">
              {tab === "pending" ? (
                <EmptyState
                  icon={CircleCheck}
                  title={t("manageVragen.emptyOpenTitle")}
                  body={t("manageVragen.emptyOpenBody")}
                />
              ) : (
                <EmptyState
                  icon={Inbox}
                  title={t("manageVragen.emptyDecided")}
                  body={t("manageVragen.emptyDecidedBody")}
                />
              )}
            </div>
          ) : (
            <RequestsBoard
              requests={requests}
              approveAction={approveCorrectionAction}
              rejectAction={rejectCorrectionAction}
            />
          )}
        </div>
      </PullToRefresh>
    </PageTransition>
  );
}
