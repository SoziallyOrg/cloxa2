"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import { Row, Section } from "../ui/List";
import { Sheet } from "../ui/Sheet";

export interface PersonAttention {
  /** The single most important issue, one short line. */
  readonly summary: string;
  /** How many more issues there are ("+1"). */
  readonly extra: number;
  /** The employee's page, where every issue is fixed. */
  readonly href: string;
  readonly items: readonly { id: string; label: string; action: string }[];
}

export interface PersonCellProps {
  name: string;
  /** Already formatted, e.g. "sinds 07:36". */
  status: string;
  /** Said before `status` to screen readers only, e.g. "Aan het werk". */
  statusWord: string | null;
  attention: PersonAttention | null;
}

/**
 * The name column of a Vandaag row. With something to look at, the whole
 * cell is one button (the name or the orange line, either works) that opens a
 * sheet with every issue and its own action.
 */
export function PersonCell({ name, status, statusWord, attention }: PersonCellProps) {
  const [open, setOpen] = useState(false);

  const body = (
    <>
      <span className="truncate text-body">{name}</span>
      <span className="truncate text-subhead text-ink-2">
        {statusWord ? <span className="sr-only">{statusWord}, </span> : null}
        {status}
      </span>
      {attention ? (
        <span className="flex items-baseline gap-2 text-subhead font-medium text-attention">
          <span className="truncate">{attention.summary}</span>
          {attention.extra > 0 ? (
            <span className="shrink-0 tabular-nums">
              {t("manage.attentionMore", { count: attention.extra })}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  if (!attention) {
    return <div className="flex min-w-0 flex-col">{body}</div>;
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${name}. ${t("manage.attentionOpen", { name })}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="focus-ring -my-3 flex min-h-touch-target min-w-0 flex-col justify-center py-3 text-left"
      >
        {body}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manage.attentionSheetTitle", { name })}
      >
        <Section>
          {attention.items.map((item) => (
            <Row
              key={item.id}
              href={attention.href}
              title={item.label}
              wrap
              value={item.action}
            />
          ))}
        </Section>
      </Sheet>
    </>
  );
}
