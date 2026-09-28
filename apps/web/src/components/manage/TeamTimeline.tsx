import Link from "next/link";
import type { Route } from "next";
import { Users } from "lucide-react";

import { t } from "@cloxa/i18n";

import type { TimelineRowModel } from "@/lib/manage/timeline";

import { EmptyState } from "../ui/EmptyState";
import { PUSH } from "../ui/transitions";
import { TimelineAxis, TimelineNow, TimelineTrack } from "./Timeline";

export interface TeamTimelinePerson {
  readonly id: string;
  readonly name: string;
  /** Already formatted, e.g. "sinds 07:36" or "start 13:00". */
  readonly status: string;
  /** Said before `status` to screen readers only, e.g. "Aan het werk". */
  readonly statusWord: string | null;
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
  /** The "now" hairline, `null` outside 06–22h. */
  nowPct: number | null;
}

// Name, the 06–22h track and today's net. Shared by the axis, the rows and
// the "now" overlay, so the three columns always line up.
const DESKTOP_COLUMNS =
  "md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_6.5rem] md:gap-x-8";

/**
 * Vandaag's team timeline. One markup for both sizes: on desktop, rows of
 * name, track and net on the white page with hairlines between them; on
 * phones, a soft group of compact rows (name, status and net, a mini bar
 * underneath).
 */
export function TeamTimeline({ people, nowPct }: TeamTimelineProps) {
  if (people.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("manage.emptyTeamTitle")}
        body={t("manage.emptyTeamBody")}
      />
    );
  }

  return (
    <section aria-label={t("manage.timelineLabel")} className="flex flex-col">
      <div aria-hidden="true" className={`hidden pb-2 md:grid ${DESKTOP_COLUMNS}`}>
        <span />
        <TimelineAxis />
      </div>
      <div className="relative">
        {nowPct !== null ? (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-10 hidden md:grid ${DESKTOP_COLUMNS}`}
          >
            <span />
            <TimelineNow positionPct={nowPct} />
          </div>
        ) : null}
        <ul className="overflow-hidden rounded-list bg-surface md:overflow-visible md:rounded-none md:bg-transparent">
          {people.map((person) => (
            <li key={person.id} className="group/row pl-4 md:pl-0">
              <div
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 py-3 pr-4 group-not-first/row:border-t-[0.5px] group-not-first/row:border-separator md:items-center md:py-3.5 md:pr-0 ${DESKTOP_COLUMNS}`}
              >
                <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
                  <span className="truncate text-body">{person.name}</span>
                  <span className="truncate text-subhead text-ink-2">
                    {person.statusWord ? (
                      <span className="sr-only">{person.statusWord}, </span>
                    ) : null}
                    {person.status}
                  </span>
                  {person.notes.length > 0 ? (
                    <span className="flex flex-wrap items-baseline gap-x-3 text-subhead">
                      <span className="font-medium text-attention">
                        {person.notes.join(" · ")}
                      </span>
                      {person.fixHref ? (
                        <Link
                          href={person.fixHref as Route}
                          transitionTypes={PUSH}
                          aria-label={t("manage.fixFor", { name: person.name })}
                          // A 44px hit area around the small word, without
                          // pushing the row apart.
                          className="focus-ring relative pressable rounded-md font-semibold text-ink before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
                        >
                          {t("manage.fix")}
                        </Link>
                      ) : null}
                    </span>
                  ) : null}
                </div>

                <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
                  <div className="md:hidden">
                    <TimelineTrack {...person.track} size="sm" />
                  </div>
                  <div className="hidden md:block">
                    <TimelineTrack {...person.track} />
                  </div>
                </div>

                <div className="col-start-2 row-start-1 text-right md:col-start-3">
                  {person.net !== null ? (
                    <span className="text-body text-ink tabular-nums">
                      <span className="sr-only">
                        {t("manage.netToday", { value: "" })}
                      </span>
                      {person.net}
                    </span>
                  ) : (
                    <span aria-hidden="true" className="text-body text-ink-3">
                      {t("common.none")}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
