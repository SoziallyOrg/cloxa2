import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

/** Plain, large text input. Use inside `Field` so the label stays visible. */
export function TextInput(props: TextInputProps) {
  return (
    <input
      {...props}
      className={cx(
        "focus-ring min-h-touch-target rounded-md border-2 border-border bg-surface px-4 text-lg text-ink",
        "aria-invalid:border-status-error",
      )}
    />
  );
}
