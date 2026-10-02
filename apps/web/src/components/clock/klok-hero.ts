/**
 * What the Klok status hero shows, as pure data (no DOM): the block colour,
 * the words and time inside the ring, and the "Vandaag" rows. Display only:
 * the state comes from the server (plus queued offline actions).
 */
import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { Shift, ShiftState } from "@cloxa/domain";

import { DEFAULT_RING_MS, formatBarTime } from "./clock-bar";
import {
  clockFace,
  openShiftBreaks,
  type PendingClockAction,
  type PlannedDay,
} from "./clock-face";
import { formatDurationMs } from "./format";

/** The block colour follows the status: forest working, amber pause, white otherwise. */
export type HeroSurface = "forest" | "amber" | "light";

export interface HeroRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface KlokHeroInput {
  state: ShiftState;
  since: number | null;
  now: number;
  todayShifts: readonly Shift[];
  pending: readonly PendingClockAction[];
  planned: PlannedDay | null;
  /** Only given when the person has more than one site. */
  siteName?: string | null;
}

export interface KlokHero {
  surface: HeroSurface;
  /** "Je werkt". */
  status: string;
  /** The big text in the ring: "4u 12", or a short phrase when there is no time yet. */
  main: string;
  /** `time` is a duration (big numerals); `text` is a phrase (smaller). */
  mainKind: "time" | "text";
  /** Spoken alternative for a duration. */
  spoken: string | null;
  /** "sinds 08:02". */
  sub: string | null;
  /** Worked time against the plan (or 8 hours), 0-1. */
  progress: number;
  running: boolean;
  /** Worked time of the open shift (0 when none is open): the live part of a week total. */
  liveWorkedMs: number;
  rows: readonly HeroRow[];
}

const time = (ms: number) => formatBrusselsTime(new Date(ms));

/** Closed shifts that ended today, oldest first. */
function finishedShifts(todayShifts: readonly Shift[]): Shift[] {
  return todayShifts
    .filter((shift) => !shift.open && shift.end !== null)
    .sort((a, b) => a.start - b.start);
}

export function klokHero(input: KlokHeroInput): KlokHero {
  const { state, since, now, todayShifts, pending, planned } = input;
  const target = planned && planned.netMs > 0 ? planned.netMs : DEFAULT_RING_MS;
  const rows: HeroRow[] = [];
  const plannedRows = () => {
    if (!planned) return;
    rows.push({
      key: "planned",
      label: t("clock.rowPlannedUntil"),
      value: time(planned.end),
    });
  };
  const siteRow = () => {
    if (input.siteName) {
      rows.push({ key: "site", label: t("clock.rowSite"), value: input.siteName });
    }
  };

  if (state !== "off" && since !== null) {
    const face = clockFace({ state, since, now, todayShifts, pending, planned });
    const { breakMs, breakSince } = openShiftBreaks(since, todayShifts, pending);
    const onBreak = state === "on_break";
    const timerMs = face.timerMs ?? 0;

    rows.push({ key: "started", label: t("clock.rowStarted"), value: time(since) });
    rows.push({
      key: "pause",
      label: t("clock.rowPause"),
      value: onBreak
        ? t("clock.rowBreakOngoing")
        : breakMs >= 60_000
          ? formatDurationMs(breakMs)
          : t("clock.rowNoBreak"),
    });
    plannedRows();
    siteRow();

    return {
      surface: onBreak ? "amber" : "forest",
      status: onBreak ? t("clock.heroBreak") : t("clock.heroWorking"),
      main: formatBarTime(timerMs),
      mainKind: "time",
      spoken: face.timerSpoken,
      sub: t("clock.heroSince", {
        time: time(onBreak ? (breakSince ?? now) : since),
      }),
      progress: Math.min(1, (face.workedMs ?? 0) / target),
      running: !onBreak,
      liveWorkedMs: face.workedMs ?? 0,
      rows,
    };
  }

  const done = finishedShifts(todayShifts);
  const last = done[done.length - 1];
  if (last && last.end !== null) {
    const worked = done.reduce((sum, shift) => sum + shift.netMs, 0);
    const pause = done.reduce((sum, shift) => sum + shift.breakMs, 0);
    rows.push({
      key: "started",
      label: t("clock.rowStarted"),
      value: time(done[0]!.start),
    });
    rows.push({ key: "stopped", label: t("clock.rowStopped"), value: time(last.end) });
    rows.push({
      key: "pause",
      label: t("clock.rowPause"),
      value: pause >= 60_000 ? formatDurationMs(pause) : t("clock.rowNoBreak"),
    });
    plannedRows();
    siteRow();
    return {
      surface: "light",
      status: t("clock.heroDone"),
      main: formatBarTime(worked),
      mainKind: "time",
      spoken: t("clock.workedSpoken", { value: formatDurationMs(worked) }),
      sub: t("clock.heroStoppedAt", { time: time(last.end) }),
      progress: Math.min(1, worked / target),
      running: false,
      liveWorkedMs: 0,
      rows,
    };
  }

  plannedRows();
  siteRow();
  return {
    surface: "light",
    status: t("clock.heroOff"),
    main: t("clock.heroNotStarted"),
    mainKind: "text",
    spoken: null,
    sub: planned ? t("schedule.todayPlanned", { range: planned.range }) : null,
    progress: 0,
    running: false,
    liveWorkedMs: 0,
    rows,
  };
}
