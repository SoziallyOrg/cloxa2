/**
 * The days a "Klopt er iets niet?" question can be about: the last 14 days,
 * newest first, each with a short worked summary and its events. Pure, so
 * it's testable without a DOM or a database.
 */
import { brusselsDayKey, deriveShifts, type ClockEvent, type Shift } from "@cloxa/domain";
import { brusselsLocalToInstant, formatBrusselsTime, t } from "@cloxa/i18n";

import { formatDurationMs } from "@/components/clock/format";
import { workedMs } from "@/components/clock/week-total";

import type { CorrectionTargetOption } from "./form";

export const CORRECTION_DAYS = 14;

export interface CorrectionDay {
  /** YYYY-MM-DD, Brussels. */
  readonly key: string;
  /** "Vandaag", "Gisteren" or "wo 23 sep". */
  readonly label: string;
  /** "woensdag 23 september". */
  readonly longLabel: string;
  /** "08:02–16:31 · 7 u 59 min", or "Geen uren". */
  readonly summary: string;
  /** Events to pick from: the day's, or only one shift's when asked for. */
  readonly targets: readonly CorrectionTargetOption[];
}

const SHORT = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const LONG = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Calendar arithmetic on a YYYY-MM-DD key (no time zone, so no DST surprises). */
export function addDays(key: string, days: number): string {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function toTarget(event: ClockEvent): CorrectionTargetOption {
  return {
    id: event.id,
    type: event.type as CorrectionTargetOption["type"],
    occurredAtIso: new Date(event.occurredAt).toISOString(),
  };
}

export interface CorrectionDaysInput {
  /** Effective events, oldest first, covering at least the days listed. */
  events: readonly ClockEvent[];
  now: number;
  /** A day chosen elsewhere ("Klopt er iets niet?"); added when older than 14 days. */
  preselected?: string | null;
  /** Start of the shift asked about: that day then only lists this shift's events. */
  shiftStart?: number | null;
}

export function correctionDays({
  events,
  now,
  preselected = null,
  shiftStart = null,
}: CorrectionDaysInput): CorrectionDay[] {
  const today = brusselsDayKey(now);
  const keys = Array.from({ length: CORRECTION_DAYS }, (_, back) =>
    addDays(today, -back),
  );
  if (preselected !== null && !keys.includes(preselected)) keys.push(preselected);

  const shifts = deriveShifts(events);

  return keys.map((key) => {
    const noon = brusselsLocalToInstant(key, "12:00");
    const dayShifts = shifts.filter((shift) => brusselsDayKey(shift.start) === key);
    const ranges = dayShifts.map((shift) => {
      const start = formatBrusselsTime(new Date(shift.start));
      const end =
        shift.end !== null
          ? formatBrusselsTime(new Date(shift.end))
          : t("shifts.openEnd");
      return `${start}–${end}`;
    });
    const worked = dayShifts.reduce((sum, shift) => sum + workedMs(shift, now), 0);

    const asked =
      key === preselected && shiftStart !== null
        ? shifts.find((shift) => shift.start === shiftStart)
        : undefined;
    // A day lists its shifts' events, also those after midnight (a night
    // shift's clock-out is on the next calendar day), not the calendar day's.
    const inShift = (event: ClockEvent, shift: Shift) =>
      event.occurredAt >= shift.start &&
      (shift.end === null || event.occurredAt <= shift.end);
    const targets = (
      asked
        ? events.filter((event) => inShift(event, asked))
        : events.filter(
            (event) =>
              dayShifts.some((shift) => inShift(event, shift)) ||
              // Strays outside any shift (a lone clock-out) stay on their own day,
              // but the tail of a night shift belongs to the day it started on.
              (brusselsDayKey(event.occurredAt) === key &&
                !shifts.some((shift) => inShift(event, shift))),
          )
    ).map((event) => {
      const option = toTarget(event);
      const eventDay = brusselsDayKey(event.occurredAt);
      return eventDay === key
        ? option
        : { ...option, dayLabel: SHORT.format(new Date(event.occurredAt)).replace(/\./g, "") };
    });

    return {
      key,
      label:
        key === today
          ? t("correctionForm.today")
          : key === addDays(today, -1)
            ? t("correctionForm.yesterday")
            : SHORT.format(noon).replace(/\./g, ""),
      longLabel: LONG.format(noon),
      summary:
        dayShifts.length === 0
          ? t("correctionForm.dayNoHours")
          : `${ranges.join(", ")} · ${formatDurationMs(worked)}`,
      targets,
    };
  });
}
