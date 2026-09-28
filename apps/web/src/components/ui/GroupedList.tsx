import Link from "next/link";
import type { Route } from "next";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

export interface GroupedListProps {
  /** Small heading above the block, e.g. "Deze week". */
  heading?: ReactNode;
  /** Heading level for `heading` (an `h2` by default). */
  headingLevel?: 2 | 3;
  /** Quiet explanation below the block. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * iOS inset-grouped list: rows on `fill` in one rounded block, hairlines
 * between them. The default pattern for lists, settings and history.
 */
export function GroupedList({
  heading,
  headingLevel = 2,
  footer,
  children,
  className,
  "data-testid": testId,
}: GroupedListProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <section className={cx("flex flex-col gap-2", className)} data-testid={testId}>
      {heading ? (
        <Heading className="px-4 text-callout font-normal text-ink-2">
          {heading}
        </Heading>
      ) : null}
      <ul className="overflow-hidden rounded-group bg-fill">{children}</ul>
      {footer ? <div className="px-4 text-callout text-ink-2">{footer}</div> : null}
    </section>
  );
}

type RowTone = "default" | "danger";

interface RowContentProps {
  /** Main text of the row. */
  title: ReactNode;
  /** Secondary text under the title. */
  detail?: ReactNode | undefined;
  /** Trailing value, e.g. a duration or a status. */
  value?: ReactNode | undefined;
  /** A trailing chevron, for rows that open something. */
  chevron?: boolean | undefined;
  tone?: RowTone | undefined;
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 14"
      className="h-3.5 w-2 shrink-0 text-ink-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m1 1 6 6-6 6" />
    </svg>
  );
}

function RowContent({
  title,
  detail,
  value,
  chevron,
  tone = "default",
}: RowContentProps) {
  return (
    <span className="flex min-h-row w-full items-center gap-3 py-3 pr-4 group-not-first/row:border-t group-not-first/row:border-line">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span
          className={cx("text-body", tone === "danger" ? "text-danger" : "text-ink")}
        >
          {title}
        </span>
        {detail ? <span className="text-callout text-ink-2">{detail}</span> : null}
      </span>
      {value !== undefined && value !== null ? (
        <span className="shrink-0 text-right text-body text-ink-2">{value}</span>
      ) : null}
      {chevron ? <Chevron /> : null}
    </span>
  );
}

const ROW_ITEM = "group/row pl-4";
const INTERACTIVE =
  "focus-ring -ml-4 flex w-[calc(100%+1rem)] rounded-none pl-4 transition-colors hover:bg-line/40 active:bg-line/70 focus-visible:-outline-offset-3";

export interface ListRowProps extends RowContentProps {
  /** Row actions, right-aligned in a footer under the row text. */
  children?: ReactNode;
}

/** A static row: title, secondary text and a trailing value. At least 56px tall. */
export function ListRow({ children, ...content }: ListRowProps) {
  return (
    <li className={ROW_ITEM}>
      <RowContent {...content} />
      {children ? (
        <div className="flex justify-end border-t border-line py-1 pr-1">
          {children}
        </div>
      ) : null}
    </li>
  );
}

export interface ListLinkRowProps extends RowContentProps {
  href: string;
  /** A plain file download (`<a download>`), not a client-side navigation. */
  download?: boolean;
}

/** A row that navigates. Shows a chevron unless it is a download. */
export function ListLinkRow({ href, download = false, ...content }: ListLinkRowProps) {
  return (
    <li className={ROW_ITEM}>
      {download ? (
        <a href={href} download className={INTERACTIVE}>
          <RowContent {...content} />
        </a>
      ) : (
        <Link href={href as Route} className={INTERACTIVE}>
          <RowContent chevron {...content} />
        </Link>
      )}
    </li>
  );
}

export interface ListButtonRowProps
  extends
    RowContentProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "value"> {
  /** Rendered inside the row's `<li>`, e.g. the sheet the row opens. */
  sheet?: ReactNode;
}

/** A row that acts (opens a sheet, submits a form, picks a choice). */
export function ListButtonRow({
  title,
  detail,
  value,
  chevron,
  tone,
  type = "button",
  sheet,
  ...button
}: ListButtonRowProps) {
  return (
    <li className={ROW_ITEM}>
      <button {...button} type={type} className={INTERACTIVE}>
        <RowContent
          title={title}
          detail={detail}
          value={value}
          chevron={chevron}
          tone={tone}
        />
      </button>
      {sheet}
    </li>
  );
}

export interface ListCheckboxRowProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "title"
> {
  title: ReactNode;
  detail?: ReactNode;
}

/** A row that is one big label for a checkbox (e.g. a site in a form). */
export function ListCheckboxRow({ title, detail, ...input }: ListCheckboxRowProps) {
  return (
    <li className={ROW_ITEM}>
      <label className="flex min-h-row w-full cursor-pointer items-center gap-3 py-3 pr-4 group-not-first/row:border-t group-not-first/row:border-line">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-ink">{title}</span>
          {detail ? <span className="text-callout text-ink-2">{detail}</span> : null}
        </span>
        <input {...input} type="checkbox" className="focus-ring size-6 shrink-0 accent-ink" />
      </label>
    </li>
  );
}
