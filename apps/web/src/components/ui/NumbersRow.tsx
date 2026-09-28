import { cx } from "./cx";

export interface NumbersRowItem {
  key: string;
  label: string;
  value: number;
  /** Orange, only for "Aandacht nodig" (and only when it isn't zero). */
  attention?: boolean;
}

export interface NumbersRowProps {
  items: readonly NumbersRowItem[];
  /** Accessible name of the group, e.g. "Vandaag in cijfers". */
  label: string;
}

/**
 * The KPI row: big light numbers with a word under each, cells separated by
 * hairlines. Four across on desktop, two by two on phones.
 */
export function NumbersRow({ items, label }: NumbersRowProps) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-2 overflow-hidden rounded-group border border-line md:grid-cols-4"
    >
      {items.map((item, index) => {
        const orange = item.attention === true && item.value > 0;
        return (
          <div
            key={item.key}
            className={cx(
              "flex flex-col-reverse justify-end gap-1 px-5 py-4 md:px-6 md:py-5",
              index % 2 === 1 && "border-l border-line",
              index >= 2 && "border-t border-line md:border-t-0",
              index === 2 && "md:border-l",
            )}
          >
            <dt className={cx("text-callout", orange ? "text-attention" : "text-ink-2")}>
              {item.label}
            </dt>
            <dd
              className={cx(
                "text-number font-normal tabular-nums",
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
