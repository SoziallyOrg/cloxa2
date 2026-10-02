import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

export type OtpInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "inputMode" | "autoComplete"
>;

/**
 * One large input for a one-time code, not six separate boxes: split boxes
 * break paste and confuse screen readers. Big tabular digits with letter
 * spacing keep it readable.
 */
export function OtpInput(props: OtpInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      className={cx(
        "h-18 w-full rounded-control border border-field bg-card pr-2 pl-[calc(0.5rem+0.35em)] text-center text-number font-medium tracking-[0.35em] text-ink tabular-nums",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
        "aria-invalid:ring-2 aria-invalid:ring-danger",
      )}
    />
  );
}
