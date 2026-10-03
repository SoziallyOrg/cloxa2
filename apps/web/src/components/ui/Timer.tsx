import { cx } from "./cx";

export interface TimerProps {
  /** The duration to show, in milliseconds (floored to the minute). */
  valueMs: number;
  /** Spoken alternative, e.g. "3 u 24 min" (the visual "3:24" reads as a time). */
  spoken: string;
  /** Dimmed, e.g. a paused count. */
  muted?: boolean;
}

/** "H:MM" from milliseconds, never negative. */
export function formatTimer(valueMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(valueMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The display-size timer: huge, light, tabular numerals. The caller
 * re-renders it (every 30 s on the clock screen).
 */
export function Timer({ valueMs, spoken, muted = false }: TimerProps) {
  return (
    <p className={cx("text-display tabular-nums", muted ? "text-ink-2" : "text-ink")}>
      <span aria-hidden="true">{formatTimer(valueMs)}</span>
      <span className="sr-only">{spoken}</span>
    </p>
  );
}
