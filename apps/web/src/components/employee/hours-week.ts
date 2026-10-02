/**
 * Pure data for the Uren week: one entry per day with the shift times
 * formatted, the planned block, and the mini day bar as percentages. The bar
 * measures local (Europe/Brussels) clock minutes, so a day with a DST change
 * still reads like the clock on the wall.
 */
import { brusselsDayKey, type Shift } from "@cloxa/domain";
import {
  formatBrusselsDate,
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
} from "@cloxa/i18n";

import { addDays } from "@/lib/corrections/days";

import { formatDurationMs } from "../clock/format";
import { formatShiftRow } from "../clock/shift-row";
import { workedMs } from "../clock/week-total";

/** A stretch on the day bar, in percent of the bar's width. */
export interface DayBarSpan {
  readonly startPct: number;
  readonly widthPct: number;
}

export interface HoursDay {
  /** `YYYY-MM-DD`. */
  readonly key: string;
  /** "ma 28 sep". */
  readonly date: string;
  /** "maandag 28 september 2026": the panel or sheet title. */
  readonly longDate: string;
  readonly hasShifts: boolean;
  /** "08:02", or "—" without shifts. */
  readonly start: string;
  /** "16:31", "nog bezig" while open, or "—". */
  readonly end: string;
  /** "08:02–16:31"; split shifts joined with ", ". */
  readonly range: string;
  readonly pause: string;
  readonly net: string;
  /** Planned blocks "08:00–16:30", or `null`. */
  readonly planned: string | null;
  readonly open: boolean;
  readonly edited: boolean;
  readonly offline: boolean;
  /** Worked at home (telework module). */
  readonly home: boolean;
  /** "2 u 10 min": how late offline events reached the server, if known. */
  readonly offlineSkew: string | null;
  readonly work: readonly DayBarSpan[];
  readonly breaks: readonly DayBarSpan[];
  /** A manager's correction on this day (ADR 010): their reason and the date it was made. */
  readonly managerCorrection?: {
    readonly reason: string;
    readonly date: string;
  } | null;
  /** "Klopt er iets niet?" starts a question for the day's last shift. */
  readonly correctionHref: string | null;
}

export interface PlannedBlock {
  readonly day: string;
  readonly start_at: string;
  readonly end_at: string;
}

export interface HoursWeek {
  readonly days: readonly HoursDay[];
  readonly workedMs: number;
  /** `null` when nothing is planned in this week. */
  readonly plannedMs: number | null;
}

const DAY_MINUTES = 24 * 60;
const MIN_WINDOW_START = 6 * 60;
const MIN_WINDOW_END = 22 * 60;

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since local midnight, as the wall clock shows them. */
export function minutesOfDay(ms: number): number {
  const parts = CLOCK.formatToParts(new Date(ms));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

interface Raw {
  readonly start: number;
  readonly end: number;
}

/** A moment as minutes of `dayKey`; later days clip to the end of the day. */
function minutesOn(dayKey: string, ms: number): number {
  return brusselsDayKey(ms) === dayKey ? minutesOfDay(ms) : DAY_MINUTES;
}

/** The week's window: 06:00-22:00, widened to whole hours for early or late work. */
export function barWindow(spans: readonly Raw[]): { start: number; end: number } {
  let start = MIN_WINDOW_START;
  let end = MIN_WINDOW_END;
  for (const span of spans) {
    start = Math.min(start, Math.floor(span.start / 60) * 60);
    end = Math.max(end, Math.ceil(span.end / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(DAY_MINUTES, end) };
}

function toSpans(
  raw: readonly Raw[],
  window: { start: number; end: number },
): DayBarSpan[] {
  const length = window.end - window.start;
  return raw
    .map((span) => {
      const from = Math.max(span.start, window.start);
      const to = Math.min(span.end, window.end);
      return {
        startPct: ((from - window.start) / length) * 100,
        widthPct: (Math.max(0, to - from) / length) * 100,
      };
    })
    .filter((span) => span.widthPct > 0);
}

export interface BuildHoursWeekInput {
  shifts: readonly Shift[];
  now: number;
  /** Monday of the week, `YYYY-MM-DD`. */
  mondayKey: string;
  todayKey: string;
  planned: readonly PlannedBlock[];
}

export function buildHoursWeek({
  shifts,
  now,
  mondayKey,
  todayKey,
  planned,
}: BuildHoursWeekInput): HoursWeek {
  const keys = Array.from({ length: 7 }, (_, index) => addDays(mondayKey, index));
  const sundayKey = keys[6]!;
  const weekShifts = shifts
    .filter((shift) => {
      const key = brusselsDayKey(shift.start);
      return key >= mondayKey && key <= sundayKey;
    })
    .sort((a, b) => a.start - b.start);

  const rawByDay = new Map<string, { work: Raw[]; breaks: Raw[] }>();
  const allWork: Raw[] = [];
  for (const shift of weekShifts) {
    const key = brusselsDayKey(shift.start);
    const entry = rawByDay.get(key) ?? { work: [], breaks: [] };
    rawByDay.set(key, entry);
    const start = minutesOfDay(shift.start);
    const end = minutesOn(key, shift.end ?? now);
    entry.work.push({ start, end: Math.max(end, start) });
    allWork.push({ start, end: Math.max(end, start) });
    for (const brk of shift.breaks) {
      const from = minutesOn(key, brk.start);
      const to = minutesOn(key, brk.end ?? now);
      if (from < DAY_MINUTES)
        entry.breaks.push({ start: from, end: Math.max(to, from) });
    }
  }
  const window = barWindow(allWork);

  let total = 0;
  const days: HoursDay[] = [];
  for (const key of keys) {
    const dayShifts = weekShifts.filter((shift) => brusselsDayKey(shift.start) === key);
    for (const shift of dayShifts) total += workedMs(shift, now);
    if (key > todayKey) continue;

    const plannedBlocks = planned.filter((block) => block.day === key);
    const plannedText =
      plannedBlocks.length === 0
        ? null
        : plannedBlocks
            .map(
              (block) =>
                `${formatBrusselsTime(new Date(block.start_at))}–${formatBrusselsTime(new Date(block.end_at))}`,
            )
            .join(", ");
    const noon = Date.parse(`${key}T12:00:00Z`);
    const base = {
      key,
      date: formatBrusselsShortDate(new Date(noon)),
      longDate: formatBrusselsDate(new Date(noon)),
      planned: plannedText,
    };

    if (dayShifts.length === 0) {
      days.push({
        ...base,
        hasShifts: false,
        start: t("common.none"),
        end: t("common.none"),
        range: t("hours.noHoursDay"),
        pause: t("common.none"),
        net: t("common.none"),
        open: false,
        edited: false,
        offline: false,
        home: false,
        offlineSkew: null,
        work: [],
        breaks: [],
        correctionHref: null,
      });
      continue;
    }

    const rows = dayShifts.map((shift) => formatShiftRow(shift));
    const first = dayShifts[0]!;
    const last = dayShifts[dayShifts.length - 1]!;
    const lastRow = rows[rows.length - 1]!;
    const raw = rawByDay.get(key) ?? { work: [], breaks: [] };
    days.push({
      ...base,
      hasShifts: true,
      start: formatBrusselsTime(new Date(first.start)),
      end:
        last.end !== null
          ? formatBrusselsTime(new Date(last.end))
          : t("hours.statusOpen"),
      range: rows.map((row) => row.range).join(", "),
      pause: formatDurationMs(dayShifts.reduce((sum, shift) => sum + shift.breakMs, 0)),
      net: formatDurationMs(
        dayShifts.reduce((sum, shift) => sum + workedMs(shift, now), 0),
      ),
      open: dayShifts.some((shift) => shift.open),
      edited: rows.some((row) => row.edited),
      offline: rows.some((row) => row.offline),
      home: dayShifts.some((shift) => shift.workLocation === "home"),
      offlineSkew: lastRow.offlineSkew,
      work: toSpans(raw.work, window),
      breaks: toSpans(raw.breaks, window),
      correctionHref: `/app/vragen/nieuw?datum=${key}&dienst=${encodeURIComponent(new Date(last.start).toISOString())}`,
    });
  }

  const plannedMs = planned
    .filter((block) => block.day >= mondayKey && block.day <= sundayKey)
    .reduce(
      (sum, block) => sum + Date.parse(block.end_at) - Date.parse(block.start_at),
      0,
    );

  return {
    days: days.reverse(),
    workedMs: total,
    plannedMs: plannedMs > 0 ? plannedMs : null,
  };
}

const WEEK_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Monday asked for in `?week=`. Only a real date that is a Monday and not
 * after the current week counts; anything else falls back to the current week.
 */
export function parseWeekParam(
  value: string | undefined,
  currentMonday: string,
): string {
  if (!value || !WEEK_PARAM.test(value)) return currentMonday;
  const date = new Date(`${value}T12:00:00Z`);
  // Rejects 2026-02-30, which Date would silently roll over.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return currentMonday;
  }
  if (date.getUTCDay() !== 1) return currentMonday;
  return value > currentMonday ? currentMonday : value;
}

const SHORT_DAY = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  day: "numeric",
  month: "short",
});

/** "28 sep – 4 okt" for the week starting on `mondayKey`. */
export function weekRangeLabel(mondayKey: string): string {
  const at = (key: string) => SHORT_DAY.format(new Date(`${key}T12:00:00Z`));
  return t("hours.weekRange", { from: at(mondayKey), to: at(addDays(mondayKey, 6)) });
}
