import { cx } from "./cx";

export interface ActivityIndicatorProps {
  /** `sm` (20px) inside buttons, `md` (28px) for pull-to-refresh. */
  size?: "sm" | "md";
  className?: string;
}

// Eight bars around the centre, fading behind the leading one; the whole
// wheel turns in eight steps, like the iOS activity indicator.
const BARS = [
  "rotate-0 opacity-100",
  "rotate-45 opacity-90",
  "rotate-90 opacity-80",
  "rotate-[135deg] opacity-70",
  "rotate-180 opacity-60",
  "rotate-[225deg] opacity-50",
  "rotate-[270deg] opacity-40",
  "rotate-[315deg] opacity-30",
] as const;

/** The iOS-style spinner. Decorative: pair it with visible or sr-only text. */
export function ActivityIndicator({ size = "md", className }: ActivityIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative inline-block shrink-0 animate-activity",
        size === "sm" ? "size-5" : "size-7",
        className,
      )}
    >
      {BARS.map((bar) => (
        <span
          key={bar}
          className={cx(
            "absolute top-0 left-[45.5%] h-[30%] w-[9%] origin-[50%_166.67%] rounded-full bg-current",
            bar,
          )}
        />
      ))}
    </span>
  );
}
