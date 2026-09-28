import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

/**
 * Shared look for inputs and selects: large, calm, filled, no border. A 2px
 * ink ring outside, on focus-visible only.
 */
export const inputClassName = cx(
  "min-h-row w-full rounded-control border-0 bg-surface px-4 text-body text-ink placeholder:text-ink-3",
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
  "aria-invalid:ring-2 aria-invalid:ring-danger",
);

/** Plain, large text input. Use inside `Field` so the label stays visible. */
export function TextInput(props: TextInputProps) {
  return <input {...props} className={inputClassName} />;
}
