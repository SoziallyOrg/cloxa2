"use client";

import { useState, useTransition } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Notice } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import type { StatusTone } from "../ui/StatusLine";
import { ChangeTiles } from "./ChangeTiles";
import type { RequestChange } from "./request-changes";
import { StatusChip } from "./StatusChip";

/** One question, formatted on the server. */
export interface RequestRow {
  id: string;
  /** Recorded by a manager (ADR 010): shown as information, not as a question. */
  fromManager: boolean;
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
  /** Was / Wordt per registration; empty when the proposal could not be read. */
  changes: readonly RequestChange[];
  /** The day the change is about, when known. */
  dayLabel: string | null;
}

export interface RequestsListProps {
  rows: readonly RequestRow[];
  withdrawAction: (formData: FormData) => Promise<void>;
}

/**
 * The questions as white cards: what it is about, a coloured status chip with
 * its word, and Was / Wordt. Choosing one opens its detail; a question still
 * waiting can be withdrawn there.
 */
export function RequestsList({ rows, withdrawAction }: RequestsListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  function withdraw(id: string) {
    setFailed(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      try {
        await withdrawAction(formData);
      } catch {
        setFailed(true);
        return;
      }
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
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setSelectedId(row.id)}
              className={cx(
                "focus-ring flex h-full w-full pressable flex-col gap-3 rounded-card p-4 text-left",
                row.fromManager ? "border border-line bg-fill" : "bg-card shadow-card",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="text-headline break-words">{row.title}</span>
                  <span className="text-subhead text-ink-2">
                    {row.dayLabel ?? row.shortDate}
                  </span>
                </span>
                {row.fromManager ? null : (
                  <StatusChip tone={row.statusTone} label={row.statusLabel} />
                )}
              </span>
              {row.changes.map((change, index) => (
                <ChangeTiles key={index} {...change} />
              ))}
              {row.reason ? (
                <span className="line-clamp-2 text-body text-ink-2">{row.reason}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.title ?? ""}
      >
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {selected.fromManager ? null : (
                <StatusChip tone={selected.statusTone} label={selected.statusLabel} />
              )}
              <p className="text-subhead text-ink-2">
                {selected.fromManager
                  ? t("questions.managerOriginOn", { date: selected.date })
                  : selected.date}
              </p>
            </div>
            {selected.changes.map((change, index) => (
              <ChangeTiles key={index} {...change} />
            ))}
            {selected.reason ? (
              <section className="flex flex-col gap-1 rounded-card bg-card p-4 shadow-card">
                <h3 className="text-footnote font-bold text-ink-2">
                  {selected.fromManager
                    ? t("questions.managerReason")
                    : t("questions.detailReason")}
                </h3>
                <p className="text-body break-words">{selected.reason}</p>
              </section>
            ) : null}
            {selected.managerNote ? (
              <section className="flex flex-col gap-1 rounded-card bg-card p-4 shadow-card">
                <h3 className="text-footnote font-bold text-ink-2">
                  {t("questions.detailNote")}
                </h3>
                <p className="text-body break-words">{selected.managerNote}</p>
              </section>
            ) : null}
            {selected.pending ? (
              <div className="flex flex-col gap-2">
                {failed ? (
                  <Notice tone="error" onDismiss={() => setFailed(false)}>
                    {t("questions.withdrawFailed")}
                  </Notice>
                ) : null}
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
