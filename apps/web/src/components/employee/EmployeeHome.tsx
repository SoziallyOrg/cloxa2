import type { ReactNode } from "react";

import { CalendarDays } from "lucide-react";

import type { Shift, ShiftState } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { EmptyState } from "../ui/EmptyState";
import { ClockActions, type ClockActionCallback } from "../clock/ClockActions";
import { type PendingClockAction, type PlannedDay } from "../clock/clock-face";
import { formatBarTime } from "../clock/clock-bar";
import { klokHero, type HeroRow } from "../clock/klok-hero";
import { StatusHero } from "./StatusHero";

/** One registration in "Laatste registraties", formatted on the server. */
export interface LatestEvent {
  readonly key: string;
  /** "Begonnen met werken". */
  readonly label: string;
  /** "08:02", or "ma 28 sep 08:02" for an earlier day. */
  readonly when: string;
}

/** This week's indicative figures, for the desktop column. */
export interface WeekFacts {
  /** Net worked time of the closed shifts this week; the open shift is added live. */
  readonly closedWorkedMs: number;
  /** Planned working time this week, or `null` when no schedule is known. */
  readonly plannedMs: number | null;
}

export interface EmployeeHomeProps {
  shiftState: ShiftState;
  since: number | null;
  now: number;
  todayShifts: readonly Shift[];
  /** Clock actions still queued on the device, oldest first. */
  pending?: readonly PendingClockAction[];
  /** Today's schedule, or `null` when nothing is planned. */
  planned?: PlannedDay | null;
  /** The site's name, only when the person has more than one. */
  siteName?: string | null;
  week?: WeekFacts | null;
  latest?: readonly LatestEvent[];
  onStartWork: ClockActionCallback;
  onStopWork: ClockActionCallback;
  onStartBreak: ClockActionCallback;
  onStopBreak: ClockActionCallback;
  /** Under the hero: the offline banner and sync messages, if any. */
  notice?: ReactNode;
  /** Right above the buttons: what went wrong with the last press. */
  error?: ReactNode;
  /** Disables the clock buttons, e.g. while offline. */
  actionsDisabled?: boolean;
}

const GROUP_LABEL =
  "px-1 pb-2 text-caption font-bold tracking-wide text-ink-2 uppercase";
const WHITE_ROW =
  "flex min-h-12 items-center justify-between gap-4 rounded-control bg-card px-4 py-2 shadow-card";

function FactRows({ rows }: { rows: readonly HeroRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key} className={WHITE_ROW}>
          <span className="text-body">{row.label}</span>
          <span className="text-right text-body font-bold tabular-nums">
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Klok: the status hero (colour = status, the ring is the timer, the clock
 * buttons under it) and "Vandaag" as white rows. On desktop the hero is a
 * card in a ~420px column and the other column holds today's facts, this
 * week's indicative totals and the latest registrations.
 */
export function EmployeeHome({
  shiftState,
  since,
  now,
  todayShifts,
  pending = [],
  planned = null,
  siteName = null,
  week = null,
  latest = [],
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  notice,
  error,
  actionsDisabled = false,
}: EmployeeHomeProps) {
  const hero = klokHero({
    state: shiftState,
    since,
    now,
    todayShifts,
    pending,
    planned,
    siteName,
  });

  const weekWorked = week ? week.closedWorkedMs + hero.liveWorkedMs : null;

  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[420px_minmax(0,1fr)] lg:content-start lg:items-start lg:gap-8 lg:p-8">
      <h1 className="sr-only">{t("app.heading")}</h1>

      <div className="flex flex-col gap-4">
        <StatusHero hero={hero}>
          {error}
          <ClockActions
            state={shiftState}
            surface={hero.surface}
            onStartWork={onStartWork}
            onStopWork={onStopWork}
            onStartBreak={onStartBreak}
            onStopBreak={onStopBreak}
            disabled={actionsDisabled}
          />
        </StatusHero>
        {notice ? (
          <div className="flex flex-col gap-3 px-gutter lg:px-0">{notice}</div>
        ) : null}
      </div>

      <div className="flex flex-col gap-7 px-gutter pt-6 pb-8 lg:p-0">
        <section>
          <h2 className={GROUP_LABEL}>{t("clock.todayHeading")}</h2>
          {hero.rows.length > 0 ? (
            <FactRows rows={hero.rows} />
          ) : (
            <div className="rounded-card bg-card shadow-card">
              <EmptyState
                icon={CalendarDays}
                title={t("clock.nothingPlannedTitle")}
                body={t("clock.nothingPlannedBody")}
              />
            </div>
          )}
        </section>

        {week && weekWorked !== null ? (
          <section className="hidden lg:block">
            <h2 className={GROUP_LABEL}>{t("clock.weekHeading")}</h2>
            <FactRows
              rows={[
                {
                  key: "worked",
                  label: t("clock.weekWorked"),
                  value: formatBarTime(weekWorked),
                },
                ...(week.plannedMs !== null
                  ? [
                      {
                        key: "planned",
                        label: t("clock.weekPlanned"),
                        value: formatBarTime(week.plannedMs),
                      },
                    ]
                  : []),
              ]}
            />
          </section>
        ) : null}

        <section className="hidden lg:block">
          <h2 className={GROUP_LABEL}>{t("clock.latestHeading")}</h2>
          {latest.length > 0 ? (
            <FactRows
              rows={latest.map((event) => ({
                key: event.key,
                label: event.label,
                value: event.when,
              }))}
            />
          ) : (
            <p className="px-1 text-body text-ink-2">{t("clock.latestEmpty")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
