import type { InputHTMLAttributes } from "react";

import { cx } from "./cx";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

/** Shared look for inputs and selects: large, calm, on `fill`, no heavy borders. */
export const inputClassName = cx(
  "focus-ring min-h-row w-full rounded-control border-0 bg-fill px-4 text-body text-ink placeholder:text-ink-3",
  "aria-invalid:ring-2 aria-invalid:ring-danger",
);

/** Plain, large text input. Use inside `Field` so the label stays visible. */
export function TextInput(props: TextInputProps) {
  return <input {...props} className={inputClassName} />;
}
