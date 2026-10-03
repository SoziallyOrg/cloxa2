"use client";

import { useRef, type KeyboardEvent } from "react";

import { cx } from "./cx";

export interface PanelTab<V extends string> {
  value: V;
  label: string;
  /** A lime count badge, e.g. the pending requests. Hidden at 0. */
  count?: number;
}

export interface PanelTabsProps<V extends string> {
  label: string;
  tabs: readonly [PanelTab<V>, PanelTab<V>, ...PanelTab<V>[]];
  value: V;
  onChange: (value: V) => void;
  /** Prefix of the tab and panel ids: `${idPrefix}-tab-x`, `${idPrefix}-panel`. */
  idPrefix: string;
}

/** The D toggle for the side panel: soft container, the active tab a white tile. */
export function PanelTabs<V extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
}: PanelTabsProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    refs.current[next]?.focus();
    onChange(target.value);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex min-h-touch-target gap-1 rounded-[14px] bg-toggle p-1"
    >
      {tabs.map((tab, position) => {
        const active = position === index;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              refs.current[position] = element;
            }}
            id={`${idPrefix}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={move}
            className={cx(
              "focus-ring flex min-w-0 flex-1 pressable items-center justify-center gap-2 rounded-[10px] px-2 text-subhead",
              active
                ? "bg-thumb font-bold text-ink shadow-card"
                : "font-semibold text-ink-2",
            )}
          >
            <span className="truncate">{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 ? (
              <span className="flex min-w-6 items-center justify-center rounded-full bg-lime px-1.5 text-caption text-forest-deep">
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
