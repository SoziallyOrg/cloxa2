"use client";

import { useState } from "react";

import { cx } from "./cx";
import { tap } from "./haptics";

export interface SwitchProps {
  /** The accessible name; usually the row title next to it. */
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * Form field name. Like a checkbox, the form only carries `value` while
   * on, so server actions parse it exactly like `<input type=checkbox>`.
   */
  name?: string;
  value?: string;
  id?: string;
}

/**
 * The iOS toggle, green when on, for booleans in settings. A real
 * `role="switch"` button (Space and Enter toggle it) with a 48px hit area
 * around the 51×31 track.
 */
export function Switch({
  label,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled = false,
  name,
  value = "on",
  id,
}: SwitchProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked ?? internal;

  return (
    <>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          const next = !on;
          if (checked === undefined) setInternal(next);
          tap();
          onCheckedChange?.(next);
        }}
        className={cx(
          "group focus-ring relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-0.5 transition-colors duration-200",
          // A larger invisible hit area (48px) for fingers.
          "before:absolute before:-inset-2 before:content-['']",
          "disabled:cursor-not-allowed disabled:opacity-50",
          on ? "bg-working" : "bg-track",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-[translate,width] duration-300 ease-spring group-active:w-[31px]",
            on ? "translate-x-5 group-active:translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      {name && on ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}
