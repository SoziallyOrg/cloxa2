import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

export type OtpInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "inputMode" | "autoComplete"
>;

/**
 * A single input for a one-time code, not six separate boxes: split boxes
 * break paste and confuse screen readers. Large monospaced digits with
 * letter spacing keep it readable for shared-tablet and low-vision use.
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
        "focus-ring min-h-touch-target w-full rounded-md border-2 border-border bg-surface px-4",
        "text-otp font-mono tracking-[0.4em] text-ink",
        "aria-invalid:border-status-error",
      )}
    />
  );
}
