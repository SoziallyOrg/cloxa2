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
 * A toggle for booleans in settings: forest when on, soft grey with a border when off. A real
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
          "group focus-ring relative inline-flex h-[32px] w-[56px] shrink-0 items-center rounded-[12px] p-[3px] transition-colors duration-200",
          // A larger invisible hit area (48px) for fingers.
          "before:absolute before:-inset-2 before:content-['']",
          "disabled:cursor-not-allowed disabled:opacity-50",
          on ? "bg-forest" : "bg-toggle ring-2 ring-field ring-inset",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "size-[26px] rounded-[9px] shadow-card transition-[translate,background-color] duration-200 ease-spring",
            on ? "translate-x-6 bg-white" : "translate-x-0 bg-field",
          )}
        />
      </button>
      {name && on ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}
