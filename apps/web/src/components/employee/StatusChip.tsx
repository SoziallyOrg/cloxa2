import { cx } from "../ui/cx";
import type { StatusTone } from "../ui/StatusLine";

const CHIP: Record<StatusTone, string> = {
  working: "bg-forest text-white",
  break: "bg-break text-break-ink",
  attention: "bg-danger-tint text-danger-tint-ink",
  danger: "bg-danger-tint text-danger-tint-ink",
  off: "bg-idle text-ink",
};

/** A status as a small coloured block with its word (never colour alone). */
export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cx(
        "inline-flex min-h-7 shrink-0 items-center rounded-lg px-2.5 text-caption font-bold",
        CHIP[tone],
      )}
    >
      {label}
    </span>
  );
}
