import { cx } from "./cx";

export type StatusTone = "working" | "break" | "off" | "error";

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Always pass a translated label — colour alone never carries meaning. */
  label: string;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  working: "bg-status-working-bg text-status-working",
  break: "bg-status-break-bg text-status-break",
  off: "bg-status-off-bg text-status-off",
  error: "bg-status-error-bg text-status-error",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  working: "bg-status-working",
  break: "bg-status-break",
  off: "bg-status-off",
  error: "bg-status-error",
};

/** Colour dot plus a text label. Never rely on colour alone. */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-md px-3 py-1 text-base font-semibold",
        TONE_CLASSES[tone],
      )}
    >
      <span
        aria-hidden="true"
        className={cx("size-3 rounded-full", DOT_CLASSES[tone])}
      />
      {label}
    </span>
  );
}
