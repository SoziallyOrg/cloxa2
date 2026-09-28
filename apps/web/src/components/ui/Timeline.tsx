import { cx } from "./cx";

/** A span on the track, in percent of the 06–22h window (see lib/manage/timeline). */
export interface TimelineSpanProps {
  readonly startPct: number;
  readonly widthPct: number;
}

export interface TimelineTrackProps {
  work: readonly TimelineSpanProps[];
  breaks: readonly TimelineSpanProps[];
  planned: readonly TimelineSpanProps[];
  /** The live end of a shift that is still open. */
  openEdgePct?: number | null;
  /** `md`: the desktop row (28px). `sm`: the phone mini bar (8px). */
  size?: "md" | "sm";
}

const pct = (value: number) => `${value}%`;

/**
 * One row of the manager timeline, drawn in SVG so positions are attributes
 * (percentages), never inline styles, which the CSP forbids. Worked time is
 * ink, a break `ink-3`, planned-but-not-started a dashed outline. The open
 * edge breathes, and stands still under reduced motion. Decorative: the row
 * around it says the same in words.
 */
export function TimelineTrack({
  work,
  breaks,
  planned,
  openEdgePct = null,
  size = "md",
}: TimelineTrackProps) {
  const md = size === "md";
  const barY = md ? 4 : 0;
  const barHeight = md ? 20 : 8;
  const radius = md ? 6 : 4;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cx("block w-full overflow-visible", md ? "h-7" : "h-2")}
    >
      <rect x="0" y="0" width="100%" height="100%" rx={radius} className="fill-fill" />
      {planned.map((span, index) => (
        <rect
          key={`p${index}`}
          x={pct(span.startPct)}
          y={barY + 0.75}
          width={pct(span.widthPct)}
          height={barHeight - 1.5}
          rx={radius}
          className="fill-none stroke-ink-3"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ))}
      {work.map((span, index) => (
        <rect
          key={`w${index}`}
          x={pct(span.startPct)}
          y={barY}
          width={pct(span.widthPct)}
          height={barHeight}
          rx={radius}
          className="fill-ink"
        />
      ))}
      {breaks.map((span, index) => (
        <rect
          key={`b${index}`}
          x={pct(span.startPct)}
          y={barY}
          width={pct(span.widthPct)}
          height={barHeight}
          rx={radius}
          className="fill-ink-3"
        />
      ))}
      {openEdgePct !== null ? (
        <rect
          x={pct(openEdgePct)}
          y={barY - (md ? 3 : 1)}
          width={md ? 3 : 2}
          height={barHeight + (md ? 6 : 2)}
          rx={1.5}
          // Centred on the live end of the bar.
          transform={md ? "translate(-1.5 0)" : "translate(-1 0)"}
          className="fill-ink motion-safe:animate-pulse"
        />
      ) : null}
    </svg>
  );
}

export interface TimelineAxisProps {
  /** `[hour, positionPct]` pairs. */
  ticks: readonly (readonly [number, number])[];
}

/** Light hour labels above the timeline ("6 9 12 15 18 21"). */
export function TimelineAxis({ ticks }: TimelineAxisProps) {
  return (
    <svg aria-hidden="true" focusable="false" className="block h-5 w-full overflow-visible">
      {ticks.map(([hour, position], index) => (
        <text
          key={hour}
          x={pct(position)}
          y="14"
          textAnchor={index === 0 ? "start" : "middle"}
          className="fill-ink-3 text-[13px]"
        >
          {hour}
        </text>
      ))}
    </svg>
  );
}

/** The "now" hairline across all rows; the caller positions the overlay. */
export function TimelineNow({ positionPct }: { positionPct: number }) {
  return (
    <svg aria-hidden="true" focusable="false" className="block h-full w-full overflow-visible">
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
