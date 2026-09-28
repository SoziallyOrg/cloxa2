import type { TimelineRowModel, TimelineSpan } from "@/lib/manage/timeline";
import {
  TIMELINE_AXIS_HOURS,
  TIMELINE_END_HOUR,
  TIMELINE_START_HOUR,
} from "@/lib/manage/timeline";

import { cx } from "../ui/cx";

export interface TimelineTrackProps extends TimelineRowModel {
  /** `md`: a desktop row (24px bar). `sm`: the phone mini bar (8px). */
  size?: "md" | "sm";
}

const pct = (value: number) => `${value}%`;

/** Hour labels as `[hour, positionPct]`, from the fixed 06–22h window. */
export const AXIS_TICKS: readonly (readonly [number, number])[] =
  TIMELINE_AXIS_HOURS.map((hour) => [
    hour,
    ((hour - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100,
  ]);

/**
 * One row of the team timeline, drawn in SVG so positions are attributes
 * (percentages), never inline styles, which the nonce CSP forbids. Worked
 * time is ink, a break `ink-3` on top, planned-but-not-started a dashed
 * outline. The live end of an open shift breathes softly and stands still
 * under reduced motion. Decorative: the row around it says the same in words.
 */
export function TimelineTrack({
  work,
  breaks,
  planned,
  openEdgePct,
  size = "md",
}: TimelineTrackProps) {
  const md = size === "md";
  const height = md ? 24 : 8;
  const radius = md ? 6 : 4;
  const bar = (span: TimelineSpan, key: string, className: string) => (
    <rect
      key={key}
      x={pct(span.startPct)}
      y={0}
      width={pct(span.widthPct)}
      height={height}
      rx={radius}
      className={className}
    />
  );

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cx("block w-full overflow-visible", md ? "h-6" : "h-2")}
    >
      <rect
        x="0"
        y="0"
        width="100%"
        height={height}
        rx={radius}
        className={md ? "fill-fill" : "fill-track"}
      />
      {planned.map((span, index) => (
        <rect
          key={`p${index}`}
          x={pct(span.startPct)}
          y={0.75}
          width={pct(span.widthPct)}
          height={height - 1.5}
          rx={radius}
          className="fill-none stroke-ink-3"
          strokeWidth={1.5}
          strokeDasharray={md ? "4 3" : "3 2"}
        />
      ))}
      {work.map((span, index) => bar(span, `w${index}`, "fill-ink"))}
      {breaks.map((span, index) => bar(span, `b${index}`, "fill-ink-3"))}
      {openEdgePct !== null ? (
        <rect
          x={pct(openEdgePct)}
          y={md ? -3 : -2}
          width={md ? 4 : 3}
          height={height + (md ? 6 : 4)}
          rx={md ? 2 : 1.5}
          transform={md ? "translate(-2 0)" : "translate(-1.5 0)"}
          className="fill-ink motion-safe:animate-pulse"
        />
      ) : null}
    </svg>
  );
}

/** Light hour labels above the timeline: 6, 9, 12, 15, 18, 21. */
export function TimelineAxis() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="block h-5 w-full overflow-visible"
    >
      {AXIS_TICKS.map(([hour, position], index) => (
        <text
          key={hour}
          x={pct(position)}
          y="13"
          textAnchor={index === 0 ? "start" : "middle"}
          className="fill-ink-3 text-[13px] tabular-nums"
        >
          {hour}
        </text>
      ))}
    </svg>
  );
}

/** The "now" hairline across every row; the caller places it over the track column. */
export function TimelineNow({ positionPct }: { positionPct: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="block h-full w-full overflow-visible"
    >
      <line
        x1={pct(positionPct)}
        x2={pct(positionPct)}
        y1="0"
        y2="100%"
        className="stroke-ink-3"
        strokeWidth={1}
      />
    </svg>
  );
}
