"use client";

import Link from "next/link";
import { Users } from "lucide-react";

import { t } from "@cloxa/i18n";

import { GROUP_LABEL_KEY } from "@/lib/manage/labels";
import { groupPeople, type StatusGroup } from "@/lib/manage/today-board";

import { buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { EmptyState } from "../ui/EmptyState";
import type { StatTone } from "../ui/StatBlock";
import { StatusGroupHeader } from "../ui/StatusGroupHeader";
import { DayAxis, DayNowLine, TimelineTrack } from "./Timeline";
import type { TodayPerson } from "./today-types";

export interface DayTimelineProps {
  people: readonly TodayPerson[];
  nowPct: number | null;
  ticks: readonly (readonly [number, number])[];
  /** "12:14", for the pill on the now line. */
  nowLabel: string;
  /** "06:00 – 18:00". */
  windowLabel: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// Name, the track and hours + status. The axis, the rows and the now line all
// use this grid, so the three always line up. Container queries (`@xl`), not
// viewport ones: beside the 330px panel the main column can be narrow.
const COLUMNS = "@xl:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_minmax(6.5rem,9rem)]";

const GROUP_TONE: Record<StatusGroup, StatTone> = {
  working: "forest",
  break: "break",
  attention: "danger",
  idle: "idle",
};

/**
 * "Wie werkt wanneer": the day timeline. From 768px a card with one row per
 * person (name, track, hours); below that, people grouped under coloured
 * status headers with a mini bar each. Rows are buttons: choosing one fills
 * the side panel (a sheet on phones). Both layouts exist in the markup, CSS
 * shows one, so there is no flash on first paint.
 */
export function DayTimeline({
  people,
  nowPct,
  ticks,
  nowLabel,
  windowLabel,
  selectedId,
  onSelect,
}: DayTimelineProps) {
  if (people.length === 0) {
    return (
      <div className="rounded-card bg-card shadow-card">
        <EmptyState
          icon={Users}
          title={t("manage.emptyTeamTitle")}
          body={t("manage.emptyTeamBody")}
          action={
            <Link href="/manage/team" className={buttonClassName("primary")}>
              {t("manageToday.inviteAction")}
            </Link>
          }
        />
      </div>
    );
  }

  const toggle = (id: string) => onSelect(selectedId === id ? null : id);

  return (
    <>
      <section
        aria-label={t("manageToday.timelineTitle")}
        className="hidden rounded-card bg-card p-5 shadow-card @xl:block"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="text-section">{t("manageToday.timelineTitle")}</h2>
          <p className="text-subhead text-ink-2 tabular-nums">{windowLabel}</p>
        </header>
        <div
          aria-hidden="true"
          className={cx("mt-2 grid gap-x-4 px-3.5 pb-1", COLUMNS)}
        >
          <span />
          <DayAxis ticks={ticks} nowPosition={nowPct} nowLabel={nowLabel} />
          <span />
        </div>
        <div className="relative">
          {nowPct !== null ? (
            <div
              aria-hidden="true"
              className={cx(
                "pointer-events-none absolute inset-0 z-10 grid gap-x-4 px-3.5",
                COLUMNS,
              )}
            >
              <span />
              <DayNowLine positionPct={nowPct} />
              <span />
            </div>
          ) : null}
          <ul>
            {people.map((person) => {
              const selected = selectedId === person.id;
              const flagged = person.attentionSummary !== null;
              return (
                <li key={person.id} className="group/row">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(person.id)}
                    className={cx(
                      "focus-ring grid min-h-16 w-full items-center gap-x-4 rounded-card border-2 px-3 py-2.5 text-left",
                      COLUMNS,
                      selected
                        ? "border-forest bg-working-tint"
                        : "border-transparent group-not-first/row:border-t-line",
                    )}
                  >
                    <span className="truncate text-callout font-bold">
                      {person.name}
                    </span>
                    <span className="min-w-0">
                      <TimelineTrack
                        {...person.track}
                        tone={person.tone}
                        surface="card"
                      />
                    </span>
                    <span className="flex min-w-0 flex-col items-end text-right">
                      <span className="text-callout font-bold tabular-nums">
                        {person.hours ? (
                          <>
                            <span className="sr-only">
                              {t("manage.netToday", {
                                value: person.hoursSpoken ?? "",
                              })}
                            </span>
                            <span aria-hidden="true">{person.hours}</span>
                          </>
                        ) : (
                          <span aria-hidden="true">{t("common.none")}</span>
                        )}
                      </span>
                      <span
                        className={cx(
                          "text-footnote",
                          flagged ? "font-semibold text-danger" : "text-ink-2",
                        )}
                      >
                        <span className="sr-only">{person.statusWord}, </span>
                        {person.attentionSummary ?? person.status}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section
        aria-label={t("manageToday.timelineTitle")}
        className="flex flex-col gap-5 @xl:hidden"
      >
        {groupPeople(people).map(({ group, people: members }) => (
          <div key={group} className="flex flex-col gap-2">
            <StatusGroupHeader
              tone={GROUP_TONE[group]}
              label={t(GROUP_LABEL_KEY[group])}
              count={members.length}
            />
            <ul className="flex flex-col gap-2">
              {members.map((person) => {
                const selected = selectedId === person.id;
                const flagged = person.attentionSummary !== null;
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(person.id)}
                      className={cx(
                        "focus-ring flex min-h-touch-target w-full flex-col gap-2 rounded-card border-2 bg-card px-4 py-3 text-left shadow-card",
                        selected ? "border-forest" : "border-transparent",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-callout font-bold">
                          {person.name}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 text-footnote",
                            flagged ? "font-semibold text-danger" : "text-ink-2",
                          )}
                        >
                          {person.attentionSummary ?? person.status}
                        </span>
                      </span>
                      <TimelineTrack
                        {...person.track}
                        tone={person.tone}
                        size="sm"
                        surface="card"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
