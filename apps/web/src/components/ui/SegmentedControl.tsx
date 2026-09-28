"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { cx } from "./cx";
import { tap } from "./haptics";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** The accessible name of the group, e.g. "Periode". */
  label: string;
  /** 2–5 short options. */
  options: readonly SegmentOption<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Form field name: the chosen value is posted with the form. */
  name?: string;
}

// Literal class names, so Tailwind finds them: one column per option, and a
// thumb one column wide that slides by whole columns.
const COLUMNS = ["", "", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5"];
const THUMB_WIDTH = [
  "",
  "",
  "w-[calc((100%-4px)/2)]",
  "w-[calc((100%-4px)/3)]",
  "w-[calc((100%-4px)/4)]",
  "w-[calc((100%-4px)/5)]",
];
const THUMB_OFFSET = [
  "translate-x-0",
  "translate-x-full",
  "translate-x-[200%]",
  "translate-x-[300%]",
  "translate-x-[400%]",
];

/**
 * The iOS segmented control: a pill track with a sliding thumb. Radio-group
 * semantics: one tab stop, arrow keys move the choice, Home and End jump to
 * the ends.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
}: SegmentedControlProps<V>) {
  const [internal, setInternal] = useState<V | undefined>(
    defaultValue ?? options[0]?.value,
  );
  const selected = value ?? internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = Math.min(Math.max(options.length, 2), 5);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );

  const choose = (next: number, focus: boolean) => {
    const option = options[next];
    if (!option) return;
    if (focus) refs.current[next]?.focus();
    if (option.value === selected) return;
    if (value === undefined) setInternal(option.value);
    tap();
    onValueChange?.(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next, true);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "relative grid min-h-touch-target rounded-[10px] bg-track p-0.5",
        COLUMNS[count],
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-0.5 bottom-0.5 left-0.5 rounded-[8px] bg-thumb shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-spring",
          THUMB_WIDTH[count],
          THUMB_OFFSET[index],
        )}
      />
      {options.map((option, position) => {
        const checked = position === index;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[position] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(position, false)}
            onKeyDown={onKeyDown}
            className={cx(
              "focus-ring relative z-10 min-w-0 truncate rounded-[8px] px-3 text-subhead text-ink pressable",
              checked ? "font-semibold" : "font-medium",
            )}
          >
            {option.label}
          </button>
        );
      })}
      {name && selected !== undefined ? (
        <input type="hidden" name={name} value={selected} />
      ) : null}
    </div>
  );
}
