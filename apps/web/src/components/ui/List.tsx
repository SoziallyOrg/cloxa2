import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { TileColor } from "@cloxa/ui-tokens";

import { cx } from "./cx";
import { PUSH } from "./transitions";

export interface ListProps {
  children: ReactNode;
  className?: string;
}

/**
 * iOS inset grouped list: `Section`s 16px from the edge on the grouped
 * background (`bg-grouped`), with room between them.
 */
export function List({ children, className }: ListProps) {
  return (
    <div className={cx("flex flex-col gap-8 px-inset", className)}>{children}</div>
  );
}

export interface SectionProps {
  /** Uppercase footnote above the group, e.g. "DEZE WEEK". */
  header?: ReactNode;
  /** Heading level for `header` (an `h2` by default). */
  headingLevel?: 2 | 3;
  /** Footnote under the group: a quiet explanation. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** One rounded group of rows (10px radius) with its header and footer. */
export function Section({
  header,
  headingLevel = 2,
  footer,
  children,
  className,
  "data-testid": testId,
}: SectionProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <section className={cx("flex flex-col", className)} data-testid={testId}>
      {header ? (
        <Heading className="px-4 pb-1.5 text-footnote font-normal tracking-wide text-ink-2 uppercase">
          {header}
        </Heading>
      ) : null}
      <ul className="overflow-hidden rounded-list bg-surface">{children}</ul>
      {footer ? (
        <div className="px-4 pt-1.5 text-footnote text-ink-2">{footer}</div>
      ) : null}
    </section>
  );
}

const TILE_CLASSES: Record<TileColor, string> = {
  gray: "bg-tile-gray",
  ink: "bg-tile-ink",
  blue: "bg-tile-blue",
  green: "bg-tile-green",
  orange: "bg-tile-orange",
  red: "bg-tile-red",
};

interface RowContent {
  title: ReactNode;
  subtitle?: ReactNode | undefined;
  /** Trailing value in the secondary colour, e.g. "7 u 59 min". */
  value?: ReactNode | undefined;
  /** A leading Settings-style icon on a coloured 29px tile. */
  icon?: LucideIcon | undefined;
  tile?: TileColor | undefined;
  /** A trailing chevron: on by default for links, off otherwise. */
  chevron?: boolean | undefined;
  /** Red title, for destructive rows ("Afmelden"). */
  tone?: "default" | "danger" | undefined;
  /**
   * A choice row: a trailing checkmark when `true`, an empty slot when
   * `false` (so titles don't shift). Pair with `aria-pressed`.
   */
  checked?: boolean | undefined;
}

export type RowProps = RowContent &
  (
    | {
        /** A row that navigates (pushes, with the slide transition). */
        href: string;
        /** A plain file download (`<a download>`), not a navigation. */
        download?: boolean;
        accessory?: never;
      }
    | ({
        href?: never;
        /** A trailing control on a static row, e.g. a `Switch`. */
        accessory?: ReactNode;
      } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "className" | "title" | "value" | "children"
      >)
  );

const INTERACTIVE =
  "focus-ring flex w-full items-center text-left transition-colors duration-200 select-none focus-visible:-outline-offset-3 active:bg-pressed active:duration-0 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * One row: a link (`href`), a button (`onClick` or `type`), or static. At
 * least 48px (52px with a subtitle). The separator is inset from the leading
 * edge, after the icon. Long titles truncate with an ellipsis. Pressed rows
 * highlight, as iOS rows do, rather than dim.
 */
export function Row(props: RowProps) {
  const {
    title,
    subtitle,
    value,
    icon,
    tile = "gray",
    chevron,
    tone = "default",
    checked,
  } = props;
  const content = (withChevron: boolean, accessory?: ReactNode) => (
    <RowBody
      title={title}
      subtitle={subtitle}
      value={value}
      icon={icon}
      tile={tile}
      tone={tone}
      chevron={chevron ?? withChevron}
      checked={checked}
      accessory={accessory}
    />
  );

  if (props.href !== undefined) {
    return (
      <li className="group/row">
        {props.download ? (
          <a href={props.href} download className={INTERACTIVE}>
            {content(false)}
          </a>
        ) : (
          <Link
            href={props.href as Route}
            transitionTypes={PUSH}
            className={INTERACTIVE}
          >
            {content(true)}
          </Link>
        )}
      </li>
    );
  }

  const { accessory, ...rest } = props;
  const button = buttonAttributes(rest);
  const isButton = button.onClick !== undefined || button.type !== undefined;

  return (
    <li className="group/row">
      {isButton ? (
        <button {...button} type={button.type ?? "button"} className={INTERACTIVE}>
          {content(false)}
        </button>
      ) : (
        <div className="flex w-full items-center">{content(false, accessory)}</div>
      )}
    </li>
  );
}

const CONTENT_KEYS = [
  "title",
  "subtitle",
  "value",
  "icon",
  "tile",
  "chevron",
  "tone",
  "checked",
  "href",
];

/** The row's own props stripped, leaving the `<button>` attributes. */
function buttonAttributes(props: object): ButtonHTMLAttributes<HTMLButtonElement> {
  const attributes: Record<string, unknown> = { ...props };
  for (const key of CONTENT_KEYS) delete attributes[key];
  return attributes;
}

function RowBody({
  title,
  subtitle,
  value,
  icon: Icon,
  tile,
  tone,
  chevron,
  checked,
  accessory,
}: RowContent & { tile: TileColor; accessory?: ReactNode }) {
  return (
    <>
      {Icon ? (
        <span
          aria-hidden="true"
          className={cx(
            "ml-4 flex size-tile shrink-0 items-center justify-center rounded-tile text-white",
            TILE_CLASSES[tile],
          )}
        >
          <Icon className="size-[18px]" strokeWidth={2} />
        </span>
      ) : null}
      <span
        className={cx(
          "flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 group-not-first/row:border-t-[0.5px] group-not-first/row:border-separator",
          Icon ? "ml-3" : "ml-4",
          subtitle ? "min-h-row-two-line" : "min-h-touch-target",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cx(
              "truncate text-body",
              tone === "danger" ? "text-danger" : "text-ink",
            )}
          >
            {title}
          </span>
          {subtitle ? (
            <span className="line-clamp-2 text-subhead text-ink-2">{subtitle}</span>
          ) : null}
        </span>
        {value !== undefined && value !== null ? (
          <span className="max-w-[45%] shrink-0 truncate text-right text-body text-ink-2 tabular-nums">
            {value}
          </span>
        ) : null}
        {accessory}
        {checked === undefined ? null : checked ? (
          <Check
            aria-hidden="true"
            className="size-5 shrink-0 text-ink"
            strokeWidth={2.75}
          />
        ) : (
          <span aria-hidden="true" className="size-5 shrink-0" />
        )}
        {chevron ? (
          <ChevronRight
            aria-hidden="true"
            className="-mr-1 size-5 shrink-0 text-ink-3"
            strokeWidth={2.5}
          />
        ) : null}
      </span>
    </>
  );
}

export interface ListItemProps {
  children: ReactNode;
  className?: string;
}

/**
 * A row of free content (a text area, a short summary) with the same
 * padding and inset separator as `Row`. For anything tappable, use `Row`.
 */
export function ListItem({ children, className }: ListItemProps) {
  return (
    <li className="group/row">
      <div
        className={cx(
          "ml-4 flex min-h-touch-target flex-col justify-center py-2.5 pr-4 group-not-first/row:border-t-[0.5px] group-not-first/row:border-separator",
          className,
        )}
      >
        {children}
      </div>
    </li>
  );
}
