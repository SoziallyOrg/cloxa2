import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import type { TimelineRowModel } from "@/lib/manage/timeline";

import { EmptyState } from "../ui/EmptyState";
import { TimelineAxis, TimelineNow, TimelineTrack } from "../ui/Timeline";

export interface TeamTimelinePerson {
  readonly id: string;
  readonly name: string;
  /** Already formatted, e.g. "sinds 07:36" or "start 13:00". */
  readonly status: string;
  /** "Aandacht nodig" notes, in orange under the name. */
  readonly notes: readonly string[];
  /** Where "Oplossen" goes, when there is a note. */
  readonly fixHref: string | null;
  /** Today's net so far, e.g. "3 u 36 min"; `null` when nothing was worked. */
  readonly net: string | null;
  readonly track: TimelineRowModel;
}

export interface TeamTimelineProps {
  people: readonly TeamTimelinePerson[];
  axis: readonly (readonly [number, number])[];
  /** The "now" hairline, `null` outside 06–22h. */
  nowPct: number | null;
}

/**
 * Vandaag's team timeline. One markup for both sizes: on desktop a grid of
 * name, 06–22h track and net; on phones the same row stacks into name,
 * status and net with a mini bar underneath.
 */
export function TeamTimeline({ people, axis, nowPct }: TeamTimelineProps) {
  if (people.length === 0) {
    return (
      <EmptyState title={t("manage.emptyTeamTitle")} body={t("manage.emptyTeamBody")} />
    );
  }

  return (
    <section aria-label={t("manage.timelineLabel")} className="relative flex flex-col">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[13rem_minmax(0,1fr)_7rem] gap-x-6 pb-2 md:grid"
      >
        <span />
        <TimelineAxis ticks={axis} />
      </div>
      {nowPct !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-6 bottom-0 left-[14.5rem] right-[8.5rem] hidden md:block"
        >
          <TimelineNow positionPct={nowPct} />
        </div>
      ) : null}
      <ul className="flex flex-col">
        {people.map((person) => (
          <li
            key={person.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-b border-line py-4 md:grid-cols-[13rem_minmax(0,1fr)_7rem] md:items-center md:gap-x-6 md:py-3"
          >
            <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
              <span className="truncate text-body font-medium">{person.name}</span>
              <span className="text-callout text-ink-2">{person.status}</span>
              {person.notes.length > 0 ? (
                <span className="text-callout font-medium text-attention">
                  {person.notes.join(" · ")}
                </span>
              ) : null}
            </div>

            <div className="col-span-2 row-start-2 self-center md:col-span-1 md:col-start-2 md:row-start-1">
              <div className="md:hidden">
                <TimelineTrack {...person.track} size="sm" />
              </div>
              <div className="hidden md:block">
                <TimelineTrack {...person.track} />
              </div>
            </div>

            <div className="col-start-2 row-start-1 flex flex-col items-end md:col-start-3">
              {person.net !== null || person.fixHref === null ? (
                <span className="text-body text-ink tabular-nums">
                  {person.net ?? "—"}
                </span>
              ) : null}
              {person.fixHref ? (
                <Link
                  href={person.fixHref as Route}
                  aria-label={`${t("manage.fix")} ${t("manage.fixFor", { name: person.name })}`}
                  className="focus-ring -mr-3 inline-flex min-h-touch-target items-center rounded-control px-3 text-callout font-semibold text-attention hover:bg-fill"
                >
                  {t("manage.fix")}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
