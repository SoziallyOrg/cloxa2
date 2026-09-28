import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  /** One quiet line under the title, e.g. the date. */
  subtitle?: ReactNode;
  /** A back link above the title. */
  back?: ReactNode;
  /** Something small at the top right on desktop (a filter, one action). */
  trailing?: ReactNode;
}

/** The title block of a page: optional back link, title, subtitle, one trailing control. */
export function PageHeader({ title, subtitle, back, trailing }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      {back}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title">{title}</h1>
          {subtitle ? <p className="text-body text-ink-2">{subtitle}</p> : null}
        </div>
        {trailing ? <div className="flex shrink-0">{trailing}</div> : null}
      </div>
    </header>
  );
}
