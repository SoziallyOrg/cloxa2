import { cx } from "./cx";
import type { StatTone } from "./StatBlock";

export interface StatusGroupHeaderProps {
  tone: StatTone;
  label: string;
  count: number;
}

const TONES: Record<StatTone, string> = {
  forest: "bg-forest text-white",
  break: "bg-break text-break-ink",
  idle: "bg-idle text-ink",
  danger: "bg-danger-tint text-danger-tint-ink",
};

/** The small coloured bar above a group of rows on phones ("Aan het werk  4"). */
export function StatusGroupHeader({ tone, label, count }: StatusGroupHeaderProps) {
  return (
    <div
      className={cx(
        "flex min-h-10 items-center justify-between gap-3 rounded-control px-4 text-caption",
        TONES[tone],
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </div>
  );
}
