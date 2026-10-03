import { colors } from "@cloxa/ui-tokens";

import { cringGeometry } from "./cring-geometry";
import { cx } from "./cx";

export type CRingTone = "on-forest" | "on-light" | "on-amber";

export interface CRingProps {
  /** Worked time against the planned shift (or 8 hours): 0-1, never beyond full. */
  progress: number;
  /** Width and height in px. */
  size: number;
  tone?: CRingTone;
  /** The clock is running: the dot glows gently (not with reduced motion). */
  running?: boolean;
  className?: string;
}

const c = colors.light;

const TONES: Record<CRingTone, { track: string; progress: string; dot: string }> = {
  "on-forest": { track: "rgb(255 255 255 / 0.16)", progress: "#ffffff", dot: c.lime },
  "on-light": { track: c.track, progress: c.forest, dot: c.leaf },
  "on-amber": { track: "rgb(107 74 0 / 0.2)", progress: c.breakInk, dot: c.forest },
};

/**
 * The logo's open "c" as the work timer (docs/design.md). Decorative: the
 * time and status are always written next to it. Pure SVG attributes, no
 * inline style (CSP).
 */
export function CRing({
  progress,
  size,
  tone = "on-forest",
  running = false,
  className,
}: CRingProps) {
  const geometry = cringGeometry(progress, size);
  const colour = TONES[tone];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 260 260"
      className={cx("shrink-0", className)}
    >
      <g fill="none" strokeWidth={geometry.strokeWidth} strokeLinecap="round">
        <path d={geometry.trackPath} stroke={colour.track} />
        {geometry.progressPath ? (
          <path d={geometry.progressPath} stroke={colour.progress} />
        ) : null}
      </g>
      <circle
        cx={geometry.dot.x}
        cy={geometry.dot.y}
        r={geometry.dotRadius}
        fill={colour.dot}
        className={running ? "motion-safe:animate-now-pulse" : undefined}
      />
    </svg>
  );
}
