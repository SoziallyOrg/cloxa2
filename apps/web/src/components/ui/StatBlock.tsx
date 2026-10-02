import { cx } from "./cx";

export type StatTone = "forest" | "break" | "idle" | "danger";

export interface StatBlockProps {
  tone: StatTone;
  value: number;
  /** The word is always shown: colour alone never carries the status. */
  label: string;
}

const TONES: Record<StatTone, string> = {
  forest: "bg-forest text-white",
  break: "bg-break text-break-ink",
  idle: "bg-idle text-ink",
  danger: "bg-danger-tint text-danger-tint-ink",
};

/** A status as a colour block: a bold number and its word ("4 aan het werk"). */
export function StatBlock({ tone, value, label }: StatBlockProps) {
  return (
    <div
      className={cx(
        "flex min-h-14 min-w-0 flex-wrap items-baseline gap-x-2.5 rounded-card px-4 py-3",
        TONES[tone],
      )}
    >
      <span className="text-number">{value}</span>
      <span className="text-callout font-semibold break-words">{label}</span>
    </div>
  );
}
