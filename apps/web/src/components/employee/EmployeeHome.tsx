import type { ReactNode } from "react";

import { CalendarDays } from "lucide-react";

import type { Shift, ShiftState } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { EmptyState } from "../ui/EmptyState";
import { ProgressTrack } from "../ui/ProgressTrack";
import { StatusLine } from "../ui/StatusLine";
import { Timer } from "../ui/Timer";
import { ClockActions, type ClockActionCallback } from "../clock/ClockActions";
import {
  clockFace,
  type PendingClockAction,
  type PlannedDay,
} from "../clock/clock-face";
import { statusTone, statusWord } from "../clock/format";

export interface EmployeeHomeProps {
  shiftState: ShiftState;
  since: number | null;
  now: number;
  todayShifts: readonly Shift[];
  /** Clock actions still queued on the device, oldest first. */
  pending?: readonly PendingClockAction[];
  /** Today's schedule, or `null` when nothing is planned. */
  planned?: PlannedDay | null;
  onStartWork: ClockActionCallback;
  onStopWork: ClockActionCallback;
  onStartBreak: ClockActionCallback;
  onStopBreak: ClockActionCallback;
  /** Above the clock: the offline banner and sync messages, if any. */
  notice?: ReactNode;
  /** Right above the buttons: what went wrong with the last press. */
  error?: ReactNode;
  /** Disables the clock buttons, e.g. while offline. */
  actionsDisabled?: boolean;
}

/**
 * Klok: the status line, the timer, "Gestart om 08:02 · geen pauze" and the
 * progress against today's schedule; the actions sit at the bottom, in reach
 * of the thumb. Works from 320px wide with no horizontal scroll.
 */
export function EmployeeHome({
  shiftState,
  since,
  now,
  todayShifts,
  pending = [],
  planned = null,
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  notice,
  error,
  actionsDisabled = false,
}: EmployeeHomeProps) {
  const face = clockFace({
    state: shiftState,
    since,
    now,
    todayShifts,
    pending,
    planned,
  });

  const nothingPlanned = shiftState === "off" && face.plannedLine === null;

  return (
    <div className="flex flex-1 flex-col px-gutter pb-6 md:justify-center md:px-gutter-desktop md:py-16">
      <h1 className="sr-only">{t("app.heading")}</h1>
      {notice ? <div className="flex flex-col gap-3 pt-2 pb-4">{notice}</div> : null}

      <section className="flex flex-col pt-8 md:pt-0">
        <StatusLine tone={statusTone(shiftState)} label={statusWord(shiftState)} live />
        {face.timerMs !== null && face.timerSpoken !== null ? (
          <div className="mt-5 -ml-1.5">
            <Timer valueMs={face.timerMs} spoken={face.timerSpoken} />
          </div>
        ) : null}
        {face.subline ? (
          <p className="mt-3 text-subhead text-ink-2">{face.subline}</p>
        ) : null}
        {face.plannedLine ? (
          <p className="mt-5 text-large-title font-light">{face.plannedLine}</p>
        ) : null}
        {face.progress ? (
          <div className="mt-10">
            <ProgressTrack label={t("clock.progressLabel")} {...face.progress} />
          </div>
        ) : null}
      </section>

      {nothingPlanned ? (
        <div className="flex flex-1 flex-col justify-center md:flex-none md:pt-8">
          <EmptyState
            icon={CalendarDays}
            title={t("clock.nothingPlannedTitle")}
            body={t("clock.nothingPlannedBody")}
          />
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-4 pt-10 md:mt-14 md:pt-0">
        {error}
        <ClockActions
          state={shiftState}
          onStartWork={onStartWork}
          onStopWork={onStopWork}
          onStartBreak={onStartBreak}
          onStopBreak={onStopBreak}
          disabled={actionsDisabled}
        />
      </div>
    </div>
  );
}
