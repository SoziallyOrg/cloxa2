"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { SidePanel } from "../ui/SidePanel";
import { PUSH } from "../ui/transitions";
import { ShiftTags } from "../clock/ShiftTags";
import { DayBar } from "./DayBar";
import type { HoursDay } from "./hours-week";

export interface HoursListProps {
  days: readonly HoursDay[];
}

/** The quiet notes under a day's detail: "aangepast", "offline", the sync delay. */
function detailNotes(day: HoursDay): string | null {
  const notes = [
    day.edited ? t("shifts.edited") : null,
    day.offlineSkew
      ? t("hours.detailOfflineSkew", { value: day.offlineSkew })
      : day.offline
        ? t("offline.shiftBadge")
        : null,
  ].filter((note): note is string => note !== null);
  return notes.length > 0 ? notes.join(" · ") : null;
}

// One grid serves both layouts: two columns per day on a phone, the table's
// seven columns from 1024px (Dag, Start, Einde, Pauze, Gewerkt, Gepland, Status).
const LG_COLUMNS =
  "lg:grid-cols-[minmax(5.5rem,1.1fr)_minmax(4rem,.8fr)_minmax(5rem,1fr)_minmax(4rem,.8fr)_minmax(6rem,1.1fr)_minmax(7rem,1.2fr)_minmax(4.5rem,1fr)]";
const ROW_GRID = cx(
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 lg:gap-x-3",
  LG_COLUMNS,
);

const HEAD_CELL = "text-caption font-bold tracking-wide text-ink-2 uppercase";

/**
 * The week's days: white rows with a mini day bar on a phone, a real table
 * (columns, header, selected row) on desktop. Choosing a day shows its detail
 * in the side panel (>= 1024px) or in a sheet.
 */
export function HoursList({ days }: HoursListProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = days.find((day) => day.key === selectedKey) ?? null;

  return (
    <>
      <div
        aria-hidden="true"
        className={cx("hidden px-4 pb-2 lg:grid lg:gap-x-3", LG_COLUMNS)}
      >
        <span className={HEAD_CELL}>{t("hours.colDay")}</span>
        <span className={HEAD_CELL}>{t("hours.colStart")}</span>
        <span className={HEAD_CELL}>{t("hours.colEnd")}</span>
        <span className={HEAD_CELL}>{t("hours.colPause")}</span>
        <span className={HEAD_CELL}>{t("hours.colWorked")}</span>
        <span className={HEAD_CELL}>{t("hours.colPlanned")}</span>
        <span className={HEAD_CELL}>{t("hours.colStatus")}</span>
      </div>
      <ul aria-label={t("hours.tableLabel")} className="flex flex-col gap-2 lg:gap-1">
        {days.map((day) => {
          const content = (
            <>
              <span className="min-w-0 text-body font-bold lg:col-start-1 lg:row-start-1">
                {day.date}
              </span>
              <span
                className={cx(
                  "text-right text-body font-bold whitespace-nowrap tabular-nums lg:col-start-5 lg:row-start-1 lg:text-left",
                  !day.hasShifts && "font-normal text-ink-2",
                )}
              >
                <span className="sr-only lg:hidden">{t("hours.colWorked")}: </span>
                {day.net}
              </span>
              {day.hasShifts ? (
                <>
                  <span className="col-start-1 row-start-2 text-subhead text-ink-2 lg:col-start-7 lg:row-start-1">
                    <ShiftTags
                      range={day.range}
                      rangeClassName="lg:hidden"
                      edited={day.edited}
                      offline={day.offline}
                      home={day.home}
                    />
                  </span>
                  <span className="hidden text-body tabular-nums lg:col-start-2 lg:row-start-1 lg:block">
                    {day.start}
                  </span>
                  <span className="hidden text-body tabular-nums lg:col-start-3 lg:row-start-1 lg:block">
                    {day.end}
                  </span>
                  <span className="hidden text-body tabular-nums lg:col-start-4 lg:row-start-1 lg:block">
                    {day.pause}
                  </span>
                  <span className="col-span-2 row-start-3 lg:hidden">
                    <DayBar
                      work={day.work}
                      breaks={day.breaks}
                      label={t("hours.dayBarLabel")}
                    />
                  </span>
                </>
              ) : (
                <span className="col-start-1 row-start-2 text-subhead text-ink-2 lg:hidden">
                  {day.range}
                </span>
              )}
              <span className="hidden text-body tabular-nums lg:col-start-6 lg:row-start-1 lg:block">
                {day.planned ?? t("common.none")}
              </span>
            </>
          );

          // A day without hours has no detail to open.
          if (!day.hasShifts) {
            return (
              <li
                key={day.key}
                className={cx(
                  ROW_GRID,
                  "rounded-control bg-card px-4 py-3 shadow-card lg:rounded-none lg:bg-transparent lg:shadow-none",
                )}
              >
                {content}
              </li>
            );
          }
          return (
            <li key={day.key}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-pressed={selectedKey === day.key}
                onClick={() => setSelectedKey(day.key)}
                className={cx(
                  ROW_GRID,
                  "focus-ring w-full pressable rounded-control bg-card px-4 py-3 text-left shadow-card",
                  selectedKey === day.key && "lg:ring-2 lg:ring-forest lg:ring-inset",
                )}
              >
                {content}
              </button>
            </li>
          );
        })}
      </ul>

      <SidePanel
        title={selected?.longDate ?? t("hours.heading")}
        sheetOpen={selected !== null}
        onSheetClose={() => setSelectedKey(null)}
      >
        {selected ? (
          <DayDetail day={selected} />
        ) : (
          <p className="text-body text-ink-2">{t("hours.panelHint")}</p>
        )}
      </SidePanel>
    </>
  );
}

function DayDetail({ day }: { day: HoursDay }) {
  const notes = detailNotes(day);
  const rows = [
    { key: "time", label: t("hours.detailTime"), value: day.range },
    { key: "pause", label: t("hours.detailPause"), value: day.pause },
    { key: "net", label: t("hours.detailNet"), value: day.net },
    ...(day.planned
      ? [{ key: "planned", label: t("hours.colPlanned"), value: day.planned }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="hidden text-title-2 xl:block">{day.longDate}</h2>
      <DayBar
        work={day.work}
        breaks={day.breaks}
        label={t("hours.dayBarLabel")}
        size="lg"
      />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex min-h-12 items-center justify-between gap-4 rounded-control bg-card px-4 py-2 shadow-card xl:bg-paper xl:shadow-none"
          >
            <span className="text-body">{row.label}</span>
            <span className="text-right text-body font-bold tabular-nums">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      {notes ? <p className="text-subhead text-ink-2">{notes}</p> : null}
      {(day.managerCorrections ?? []).map((note, index) => (
        <section
          key={index}
          className="flex flex-col gap-1 rounded-card border border-line bg-fill p-4"
        >
          <h3 className="text-footnote font-bold text-ink-2">
            {t("questions.managerOrigin")}
          </h3>
          <p className="text-subhead text-ink-2">
            {t("questions.managerOriginOn", { date: note.date })}
          </p>
          <p className="text-body break-words">{note.reason}</p>
        </section>
      ))}
      {day.correctionHref ? (
        <Link
          href={day.correctionHref as Route}
          transitionTypes={PUSH}
          className={buttonClassName("primary", "md", true)}
        >
          {t("hours.somethingWrong")}
        </Link>
      ) : null}
    </div>
  );
}
