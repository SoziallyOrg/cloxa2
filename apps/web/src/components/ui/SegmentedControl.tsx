import Link from "next/link";
import type { Route } from "next";

import { cx } from "./cx";

const TRACK = "flex w-full gap-1 rounded-control bg-fill p-1 md:w-auto md:self-start";
const SEGMENT =
  "focus-ring flex min-h-touch-target min-w-0 flex-1 items-center justify-center rounded-[10px] px-4 text-center text-callout md:flex-none";
const ACTIVE = "bg-paper font-semibold text-ink dark:bg-line";
const IDLE = "text-ink-2 hover:text-ink";

export interface SegmentLink {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/**
 * iOS-style segmented control for switching between views of one list
 * ("In behandeling / Behandeld"). Each segment is a real link, so it works
 * without JavaScript and every view has its own URL.
 */
export function SegmentedLinks({
  items,
  label,
}: {
  items: readonly SegmentLink[];
  /** Accessible name, e.g. "Welke aanvragen?". */
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex">
      <ul className={TRACK}>
        {items.map((item) => (
          <li key={item.key} className="flex flex-1 md:flex-none">
            <Link
              href={item.href as Route}
              aria-current={item.current ? "page" : undefined}
              className={cx(SEGMENT, "w-full", item.current ? ACTIVE : IDLE)}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** The same control as buttons, for choices inside a form (e.g. a period). */
export function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentOption<T>[];
  /** `null` when none of the options matches (e.g. a hand-picked period). */
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className={TRACK}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(SEGMENT, option.value === value ? ACTIVE : IDLE)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
