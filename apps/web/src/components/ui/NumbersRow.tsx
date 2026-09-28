import { cx } from "./cx";

export interface NumbersRowItem {
  key: string;
  label: string;
  value: number;
  /** Orange, only for "Aandacht nodig" (and only while it isn't zero). */
  attention?: boolean;
}

export interface NumbersRowProps {
  items: readonly NumbersRowItem[];
  /** The accessible name of the group, e.g. "Vandaag in cijfers". */
  label: string;
}

/**
 * The KPI row: big light numbers with a word under each, cells separated by
 * hairlines, no boxes. Four across on desktop, two by two on phones.
 * Changes are announced politely (the page refreshes itself).
 */
export function NumbersRow({ items, label }: NumbersRowProps) {
  return (
    <dl
      aria-label={label}
      aria-live="polite"
      className="grid grid-cols-2 md:grid-cols-4"
    >
      {items.map((item, index) => {
        const orange = item.attention === true && item.value > 0;
        return (
          <div
            key={item.key}
            className={cx(
              "flex min-w-0 flex-col-reverse justify-end gap-0.5 py-3 pr-4",
              // Hairlines between cells: the right column on phones, every
              // cell after the first on desktop.
              index % 2 === 1 ? "border-l-[0.5px] border-separator pl-4" : "pl-0",
              index === 2 && "md:border-l-[0.5px] md:border-separator md:pl-4",
              index >= 2 && "border-t-[0.5px] border-separator md:border-t-0",
            )}
          >
            <dt
              className={cx(
                "truncate text-subhead",
                orange ? "font-medium text-attention" : "text-ink-2",
              )}
            >
              {item.label}
            </dt>
            <dd
              className={cx(
                "text-number font-light",
                orange ? "text-attention" : "text-ink",
              )}
            >
              {item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
