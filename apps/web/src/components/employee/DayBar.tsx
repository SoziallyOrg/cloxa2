"use client";

// A client module on purpose, like the manager's timeline: a server-rendered
// <svg> that streams in late is replaced by a placeholder with an inline
// style, which the nonce CSP blocks.
import { cx } from "../ui/cx";
import type { DayBarSpan } from "./hours-week";

export interface DayBarProps {
  work: readonly DayBarSpan[];
  breaks: readonly DayBarSpan[];
  /** Spoken name; the numbers around it say the same in words. */
  label: string;
  size?: "sm" | "lg";
}

const pct = (value: number) => `${value}%`;

/**
 * The day as a rounded track: forest where worked, amber for pauses. SVG, so
 * positions are attributes (percentages), never inline styles.
 */
export function DayBar({ work, breaks, label, size = "sm" }: DayBarProps) {
  const height = size === "lg" ? 16 : 10;
  const radius = height / 2;
  return (
    <svg
      role="img"
      aria-label={label}
      focusable="false"
      className={cx("block w-full", size === "lg" ? "h-4" : "h-2.5")}
    >
      <rect
        x="0"
        y="0"
        width="100%"
        height={height}
        rx={radius}
        className="fill-track"
      />
      {work.map((span, index) => (
        <rect
          key={`w${index}`}
          x={pct(span.startPct)}
          y={0}
          width={pct(span.widthPct)}
          height={height}
          rx={radius}
          className="fill-forest"
        />
      ))}
      {breaks.map((span, index) => (
        <rect
          key={`b${index}`}
          x={pct(span.startPct)}
          y={0}
          width={pct(span.widthPct)}
          height={height}
          rx={radius}
          className="fill-break"
        />
      ))}
    </svg>
  );
}
