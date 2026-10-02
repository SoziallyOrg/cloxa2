import type { TimelineRowModel } from "@/lib/manage/timeline";
import type { StatusGroup, TrackTone } from "@/lib/manage/today-board";

/** The forest clock block of the side panel. */
export interface PersonBlock {
  readonly tone: "working" | "break" | "idle";
  /** "Werkt sinds 08:02", "Pauze sinds 12:05", "Nog niet gestart". */
  readonly title: string;
  /** "4u 12"; `null` when nothing was worked yet. */
  readonly time: string | null;
  /** Spoken form for screen readers, e.g. "4 u 12 min". */
  readonly spoken: string | null;
  /** Worked against the plan (or 8 hours), 0-1. */
  readonly progress: number;
  readonly running: boolean;
}

export interface PersonAttentionItem {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  /** A forgotten or missing clock-in/out needs a fix; the rest is just looking. */
  readonly fix: boolean;
}

export interface TodayPerson {
  readonly id: string;
  readonly name: string;
  readonly group: StatusGroup;
  readonly tone: TrackTone;
  readonly track: TimelineRowModel;
  /** "4u 12", or `null` when nothing was worked today. */
  readonly hours: string | null;
  readonly hoursSpoken: string | null;
  /** "sinds 08:02", "Pauze sinds 12:05", "Gestopt om 12:00", "Gepland vanaf 13:00". */
  readonly status: string;
  /** Said first to screen readers: "Aan het werk", "Op pauze", ... */
  readonly statusWord: string;
  /** The one line that needs attention, or `null`. */
  readonly attentionSummary: string | null;
  readonly attentionItems: readonly PersonAttentionItem[];
  /** The employee's page: hours, corrections, everything to fix. */
  readonly href: string;
  readonly block: PersonBlock;
  /** Today's events, plus the planned end as a muted last line. */
  readonly events: readonly { time: string; label: string; muted: boolean }[];
  readonly weekWorked: string | null;
  readonly weekPlanned: string | null;
}
