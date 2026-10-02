"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CircleCheck } from "lucide-react";

import { t } from "@cloxa/i18n";

import type { RequestModel } from "@/lib/manage/requests";
import { activePanelTab, type PanelTabId } from "@/lib/manage/today-board";

import { buttonClassName } from "../ui/Button";
import { PanelTabs } from "../ui/PanelTabs";
import { SidePanel } from "../ui/SidePanel";
import { DayTimeline, type DayTimelineProps } from "./DayTimeline";
import { PersonPanel } from "./PersonPanel";
import { RequestCard } from "./RequestCard";
import type { TodayPerson } from "./today-types";

export interface TodayBoardProps extends Omit<
  DayTimelineProps,
  "selectedId" | "onSelect"
> {
  /** Open correction requests, worded for the panel. */
  requests: readonly RequestModel[];
  /** All open requests; more than `requests` when the panel shows only the oldest. */
  totalRequests: number;
  approveAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
}

/**
 * Vandaag's interactive half: the day timeline and the side panel it fills.
 * Selection is client state only. Desktop: the panel in the right column with
 * two tabs. Below 1024px: the same content in a sheet once someone is chosen.
 */
export function TodayBoard({
  requests,
  totalRequests,
  approveAction,
  rejectAction,
  ...timeline
}: TodayBoardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choice, setChoice] = useState<PanelTabId | null>(null);
  const idPrefix = useId();

  const selected = timeline.people.find((person) => person.id === selectedId) ?? null;
  const flagged = timeline.people.filter((person) => person.attentionItems.length > 0);
  const tab = activePanelTab({
    choice,
    selectedId: selected?.id ?? null,
    pendingCount: totalRequests,
  });

  // Choosing someone means "show me them": drop an earlier tab choice.
  const select = (id: string | null) => {
    setSelectedId(id);
    setChoice(null);
  };

  return (
    <>
      <DayTimeline {...timeline} selectedId={selected?.id ?? null} onSelect={select} />
      <SidePanel
        title={selected?.name ?? t("manageToday.panelTitle")}
        sheetOpen={selected !== null}
        onSheetClose={() => select(null)}
      >
        <div className="flex flex-col gap-5">
          <PanelTabs
            label={t("manageToday.panelTabsLabel")}
            idPrefix={idPrefix}
            value={tab}
            onChange={setChoice}
            tabs={[
              { value: "person", label: t("manageToday.tabPerson") },
              {
                value: "requests",
                label: t("manageToday.tabRequests"),
                count: totalRequests,
              },
            ]}
          />
          <div
            role="tabpanel"
            id={`${idPrefix}-panel`}
            aria-labelledby={`${idPrefix}-tab-${tab}`}
          >
            {tab === "person" ? (
              selected ? (
                <PersonPanel person={selected} />
              ) : (
                <p className="text-callout text-ink-2">{t("manageToday.personHint")}</p>
              )
            ) : (
              <RequestsTab
                requests={requests}
                totalRequests={totalRequests}
                flagged={flagged}
                approveAction={approveAction}
                rejectAction={rejectAction}
              />
            )}
          </div>
        </div>
      </SidePanel>
    </>
  );
}

function RequestsTab({
  requests,
  totalRequests,
  flagged,
  approveAction,
  rejectAction,
}: {
  requests: readonly RequestModel[];
  totalRequests: number;
  flagged: readonly TodayPerson[];
  approveAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
}) {
  if (requests.length === 0 && flagged.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <CircleCheck
          aria-hidden="true"
          className="size-8 text-forest"
          strokeWidth={1.5}
        />
        <p className="text-callout font-semibold">{t("manageVragen.emptyOpenTitle")}</p>
        <p className="text-subhead text-ink-2">{t("manageVragen.emptyOpenBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          surface="soft"
          approveAction={approveAction}
          rejectAction={rejectAction}
          returnTo="vandaag"
        />
      ))}
      {totalRequests > requests.length ? (
        <p className="text-subhead text-ink-2">
          {t("manageToday.requestsCapped", {
            shown: requests.length,
            total: totalRequests,
          })}
        </p>
      ) : null}
      {requests.length > 0 ? (
        <Link
          href={"/manage/vragen" as Route}
          className={buttonClassName("plain", "md", true)}
        >
          {t("manageToday.allRequests")}
        </Link>
      ) : null}
      {flagged.map((person) => (
        <div
          key={person.id}
          className="flex flex-col gap-2 rounded-card bg-danger-tint p-4 text-danger-tint-ink"
        >
          <h3 className="text-headline break-words">{person.name}</h3>
          {person.attentionItems.map((item) => (
            <div key={item.id} className="flex flex-col gap-2">
              <p className="text-subhead">{item.label}</p>
              <Link
                href={item.href as Route}
                aria-label={t("manage.fixFor", { name: person.name })}
                className={buttonClassName(
                  item.fix ? "danger" : "secondary",
                  "sm",
                  true,
                )}
              >
                {item.action}
              </Link>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
