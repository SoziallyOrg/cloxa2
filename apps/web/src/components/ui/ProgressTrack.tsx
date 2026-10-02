export interface ProgressTrackProps {
  value: number;
  max: number;
  /** Accessible name, e.g. "Gewerkt tegenover je planning". */
  label: string;
  /** Left label under the track, e.g. "08:00". */
  startLabel: string;
  /** Right label under the track, e.g. "gepland tot 16:30". */
  endLabel: string;
}

/**
 * A forest bar on a `track`. A native `<progress>`: accessible out
 * of the box, and its width needs no inline style (the CSP forbids those).
 */
export function ProgressTrack({
  value,
  max,
  label,
  startLabel,
  endLabel,
}: ProgressTrackProps) {
  const safeMax = Math.max(1, max);
  const safeValue = Math.min(Math.max(0, value), safeMax);

  return (
    <div className="flex flex-col gap-2.5">
      <progress
        value={safeValue}
        max={safeMax}
        aria-label={label}
        className="block h-2 w-full appearance-none overflow-hidden rounded-full border-0 bg-track text-forest [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-forest [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-track [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-forest"
      />
      <div className="flex items-baseline justify-between gap-4 text-subhead text-ink-2 tabular-nums">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
