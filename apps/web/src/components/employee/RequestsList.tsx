"use client";

import { useState, useTransition } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { ListItem, Row, Section } from "../ui/List";
import { Notice } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { StatusLine, type StatusTone } from "../ui/StatusLine";

/** One question, formatted on the server. */
export interface RequestRow {
  id: string;
  /** "Een tijd klopt niet", or the date when the kind is unknown. */
  title: string;
  /** "28 september 2026". */
  date: string;
  /** "ma 28 sep", in the list. */
  shortDate: string;
  statusLabel: string;
  statusTone: StatusTone;
  pending: boolean;
  reason: string | null;
  managerNote: string | null;
}

export interface RequestsListProps {
  rows: readonly RequestRow[];
  withdrawAction: (formData: FormData) => Promise<void>;
}

/**
 * The questions as an inset grouped list: what it is about, its status and
 * the reason. Tapping one opens its detail; a question still waiting can be
 * withdrawn there.
 */
export function RequestsList({ rows, withdrawAction }: RequestsListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  function withdraw(id: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      await withdrawAction(formData);
      setSelectedId(null);
      setWithdrawn(true);
    });
  }

  return (
    <>
      {withdrawn ? (
        <Notice tone="success" onDismiss={() => setWithdrawn(false)}>
          {t("questions.withdrawDone")}
        </Notice>
      ) : null}
      <Section>
        {rows.map((row) => (
          <Row
            key={row.id}
            aria-haspopup="dialog"
            title={row.title}
            subtitle={
              <>
                <StatusLine tone={row.statusTone} label={row.statusLabel} size="sm" />
                {` · ${row.shortDate}`}
                {row.reason ? (
                  <>
                    <br />
                    {row.reason}
                  </>
                ) : null}
              </>
            }
            chevron
            onClick={() => setSelectedId(row.id)}
          />
        ))}
      </Section>
      <Sheet
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.title ?? ""}
      >
        {selected ? (
          <>
            <Section>
              <Row
                title={t("questions.detailStatus")}
                value={
                  <StatusLine
                    tone={selected.statusTone}
                    label={selected.statusLabel}
                    size="sm"
                  />
                }
              />
              <Row title={t("questions.detailAsked")} value={selected.date} />
            </Section>
            {selected.reason ? (
              <Section header={t("questions.detailReason")}>
                <ListItem className="text-body break-words">{selected.reason}</ListItem>
              </Section>
            ) : null}
            {selected.managerNote ? (
              <Section header={t("questions.detailNote")}>
                <ListItem className="text-body break-words">
                  {selected.managerNote}
                </ListItem>
              </Section>
            ) : null}
            {selected.pending ? (
              <div className="flex flex-col gap-2">
                <Button
                  variant="danger"
                  wide
                  loading={pending}
                  onClick={() => withdraw(selected.id)}
                >
                  {t("questions.withdraw")}
                </Button>
                <p className="px-4 text-center text-footnote text-ink-2">
                  {t("questions.withdrawHint")}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
