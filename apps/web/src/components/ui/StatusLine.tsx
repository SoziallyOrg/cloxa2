import { cx } from "./cx";

export type StatusTone = "working" | "break" | "attention" | "danger" | "off";

export interface StatusLineProps {
  tone: StatusTone;
  /** Always a translated word: colour alone never carries meaning. */
  label: string;
  /** `lg` for the clock screen, `sm` inside lists. */
  size?: "lg" | "sm";
  /** Announce changes politely (the clock's status, not list rows). */
  live?: boolean;
}

const DOT_CLASSES: Record<StatusTone, string> = {
  working: "bg-working ring-working/20",
  break: "bg-break ring-break/20",
  attention: "bg-attention ring-attention/20",
  danger: "bg-danger ring-danger/20",
  off: "bg-ink-3 ring-ink-3/20",
};

const WORD_CLASSES: Record<StatusTone, string> = {
  working: "text-working",
  break: "text-break",
  attention: "text-attention",
  danger: "text-danger",
  off: "text-ink-2",
};

/** A 12px dot with a soft halo, followed by a word in the status colour. */
export function StatusLine({
  tone,
  label,
  size = "lg",
  live = false,
}: StatusLineProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center",
        size === "lg"
          ? "gap-3 text-body font-semibold"
          : "gap-2 text-callout font-medium",
      )}
      {...(live ? { "aria-live": "polite" as const } : {})}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-3 shrink-0 rounded-full",
          size === "lg" ? "ring-[5px]" : "ring-[3px]",
          DOT_CLASSES[tone],
        )}
      />
      <span className={WORD_CLASSES[tone]}>{label}</span>
    </span>
  );
}
