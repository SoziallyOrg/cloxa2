"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import type { RequestModel } from "@/lib/manage/requests";

import { Badge, DataHead, DataTable, Td, Th, Tr } from "../ui/DataTable";
import { SidePanel } from "../ui/SidePanel";
import { RequestCard } from "./RequestCard";

export interface RequestsBoardProps {
  requests: readonly RequestModel[];
  approveAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
}

/** "08:30 → 08:00", the change in one line for the table. */
function change(request: RequestModel): string {
  return `${request.was ?? t("manageVragen.noneValue")} ${t("manageVragen.arrow")} ${
    request.wordt ?? t("manageVragen.removedValue")
  }`;
}

/**
 * The Aanvragen list. From 1024px a table; choosing a row puts its Was/Wordt
 * detail and the decision buttons in the side panel. Below that: one card per
 * request with the buttons inside. Both are in the markup and CSS picks one,
 * so the first paint is right at every width. Decided requests show their
 * outcome instead of buttons.
 */
export function RequestsBoard({
  requests,
  approveAction,
  rejectAction,
}: RequestsBoardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = requests.find((request) => request.id === selectedId) ?? null;
  const pending = requests.some((request) => request.decision === undefined);
  const actions = pending ? { approveAction, rejectAction } : {};

  return (
    <>
      <ul aria-live="polite" className="flex flex-col gap-4 lg:hidden">
        {requests.map((request) => (
          <li key={request.id}>
            <RequestCard request={request} {...actions} />
          </li>
        ))}
      </ul>

      <div className="@container hidden lg:block">
        <DataTable label={t("manageVragen.heading")}>
          <DataHead>
            <Th>{t("manageVragen.employeeLabel")}</Th>
            <Th>{t("manageVragen.changeColumn")}</Th>
            <Th className="hidden @3xl:table-cell">{t("manageVragen.reasonColumn")}</Th>
            {pending ? null : <Th>{t("manageVragen.decisionColumn")}</Th>}
          </DataHead>
          <tbody aria-live="polite">
            {requests.map((request) => {
              const isSelected = request.id === selected?.id;
              return (
                <Tr
                  key={request.id}
                  selected={isSelected}
                  onSelect={() => setSelectedId(isSelected ? null : request.id)}
                >
                  <Td>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        // The row handles the click too; once is enough.
                        event.stopPropagation();
                        setSelectedId(isSelected ? null : request.id);
                      }}
                      className="focus-ring flex min-h-touch-target flex-col justify-center rounded-control text-left"
                    >
                      <span className="font-bold">{request.employeeName}</span>
                      <span className="text-footnote text-ink-2">
                        {request.dayLabel}
                      </span>
                    </button>
                  </Td>
                  <Td>
                    <span className="block">{request.kindLabel}</span>
                    <span className="block text-footnote text-ink-2 tabular-nums">
                      {change(request)}
                    </span>
                  </Td>
                  <Td className="hidden max-w-64 @3xl:table-cell">
                    <span className="line-clamp-2 text-subhead break-words text-ink-2">
                      {request.reason ?? t("common.none")}
                    </span>
                  </Td>
                  {request.decision ? (
                    <Td>
                      <Badge
                        tone={request.decision.tone === "working" ? "forest" : "danger"}
                      >
                        {request.decision.statusLabel}
                      </Badge>
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      </div>

      <SidePanel title={selected?.employeeName ?? t("manageToday.panelTitle")}>
        {selected ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-title-2">{t("manageVragen.detailHeading")}</h2>
            <RequestCard request={selected} surface="soft" {...actions} />
          </div>
        ) : (
          <p className="text-callout text-ink-2">{t("manageVragen.detailHint")}</p>
        )}
      </SidePanel>
    </>
  );
}
