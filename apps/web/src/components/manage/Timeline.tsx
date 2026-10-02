"use client";

// A client module on purpose: when a server-rendered <svg> streams in late,
// React marks the spot with an <svg style="display:none"> placeholder, which
// the nonce CSP blocks. Rendered here, the SVG never streams in parts.
import type { TimelineRowModel, TimelineSpan } from "@/lib/manage/timeline";

import type { TrackTone } from "@/lib/manage/today-board";

import { cx } from "../ui/cx";

const WORK_FILL: Record<TrackTone, string> = {
  working: "fill-forest",
  done: "fill-idle-bar",
  attention: "fill-danger-bar",
};

export interface TimelineTrackProps extends TimelineRowModel {
  /** `md`: a desktop row (24px bar). `sm`: the phone mini bar (8px). */
  size?: "md" | "sm";
  /** Colour of the worked bar: forest, grey when finished, red for attention. */
  tone?: TrackTone;
  /** Draw the unplanned track a touch lighter on a white surface. */
  surface?: "paper" | "card";
}

const pct = (value: number) => `${value}%`;

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
  tone = "working",
  surface = "paper",
}: TimelineTrackProps) {
  const workFill = WORK_FILL[tone];
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
        className={md || surface === "card" ? "fill-fill" : "fill-track"}
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
      {work.map((span, index) => bar(span, `w${index}`, workFill))}
      {/* Work that began before the window: a flat left edge, no rounded start. */}
      {work
        .filter((span) => span.continuesLeft)
        .map((span, index) => (
          <rect
            key={`c${index}`}
            x={pct(span.startPct)}
            y={0}
            width={radius * 2}
            height={height}
            className={workFill}
          />
        ))}
      {breaks.map((span, index) => bar(span, `b${index}`, "fill-break"))}
      {openEdgePct !== null ? (
        <rect
          x={pct(openEdgePct)}
          y={md ? -3 : -2}
          width={md ? 4 : 3}
          height={height + (md ? 6 : 4)}
          rx={md ? 2 : 1.5}
          transform={md ? "translate(-2 0)" : "translate(-1.5 0)"}
          className={cx(workFill, "motion-safe:animate-pulse")}
        />
      ) : null}
    </svg>
  );
}

/**
 * The hour scale of the day timeline with the forest "● 12:14" pill on top
 * of the now line. All SVG attributes (the nonce CSP forbids inline styles).
 */
export function DayAxis({
  ticks,
  nowPosition,
  nowLabel,
}: {
  ticks: readonly (readonly [number, number])[];
  nowPosition: number | null;
  nowLabel: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="block h-9 w-full overflow-visible"
    >
      {ticks.map(([hour, position]) => (
        <text
          key={`${hour}-${position}`}
          x={pct(position)}
          y="30"
          textAnchor={position === 0 ? "start" : "middle"}
          className="fill-ink-2 text-[13px] tabular-nums"
        >
          {String(hour).padStart(2, "0")}
        </text>
      ))}
      {nowPosition !== null ? (
        <g>
          <rect
            x={pct(nowPosition)}
            y="0"
            width="60"
            height="20"
            rx="10"
            transform="translate(-30 0)"
            className="fill-forest"
          />
          <circle
            cx={pct(nowPosition)}
            cy="10"
            r="3"
            transform="translate(-16 0)"
            className="fill-lime"
          />
          <text
            x={pct(nowPosition)}
            y="14.5"
            textAnchor="middle"
            transform="translate(5 0)"
            className="fill-white text-[12px] font-bold tabular-nums"
          >
            {nowLabel}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** A vertical forest line over every row at "now", 2px wide. */
export function DayNowLine({ positionPct }: { positionPct: number }) {
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
        className="stroke-forest"
        strokeWidth={2}
      />
    </svg>
  );
}
