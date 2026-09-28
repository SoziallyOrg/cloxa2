import { cloneElement, type ReactElement } from "react";

import { t } from "@cloxa/i18n";

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** A single form control, e.g. `TextInput` or `OtpInput`. */
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string | undefined;
    "aria-invalid"?: boolean | undefined;
  }>;
}

/**
 * Label always visible above the input (never placeholder-only), with hint
 * and error text linked via `aria-describedby` so screen readers announce
 * them. Errors sit right under the field that caused them.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  children,
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
        {optional ? (
          <span className="ml-2 font-normal text-ink-2">({t("ui.optional")})</span>
        ) : null}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-subhead text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-subhead font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
