"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import type { TimelineRowModel } from "@/lib/manage/timeline";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { StatusLine, type StatusTone } from "../ui/StatusLine";
import { TextInput } from "../ui/TextInput";
import { TimelineAxis, TimelineTrack } from "../ui/Timeline";

export interface RequestCardChange {
  readonly typeLabel: string;
  readonly beforeLabel: string | null;
  readonly afterLabel: string | null;
}

export interface RequestCardDecision {
  readonly tone: StatusTone;
  readonly statusLabel: string;
  readonly note: string | null;
}

/** One line of the before/after mini timeline of the day. */
export interface RequestCardDay {
  readonly track: TimelineRowModel;
  /** "08:02–16:30", or "Geen uren". */
  readonly summary: string;
}

export interface RequestCardProps {
  readonly id: string;
  readonly employeeName: string;
  readonly dateLabel: string;
  readonly kindLabel: string;
  readonly changes: readonly RequestCardChange[];
  readonly before: RequestCardDay;
  readonly after: RequestCardDay;
  readonly axis: readonly (readonly [number, number])[];
  /** Null once the requester was anonymised (ADR 007). */
  readonly reason: string | null;
  /** Present for the "Behandeld" tab; absent (pending) shows the decide buttons. */
  readonly decision?: RequestCardDecision;
  readonly approveAction?: (formData: FormData) => Promise<void>;
  readonly rejectAction?: (formData: FormData) => Promise<void>;
}

function DayLine({ label, day }: { label: string; day: RequestCardDay }) {
  return (
    <>
      <span className="text-callout text-ink-2">{label}</span>
      <TimelineTrack {...day.track} />
      <span className="text-callout text-ink tabular-nums">{day.summary}</span>
    </>
  );
}

/**
 * One correction request: who, which day, what they ask in plain words, that
 * day before and after, and their reason. "Afwijzen" asks for a note first.
 */
export function RequestCard({
  id,
  employeeName,
  dateLabel,
  kindLabel,
  changes,
  before,
  after,
  axis,
  reason,
  decision,
  approveAction,
  rejectAction,
}: RequestCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const noteId = `reject-note-${id}`;

  return (
    <li className="flex flex-col gap-5 rounded-group border border-line p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <span className="text-headline">{employeeName}</span>
          <span className="text-callout text-ink-2">{dateLabel}</span>
        </div>
        {decision ? (
          <StatusLine size="sm" tone={decision.tone} label={decision.statusLabel} />
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-body font-semibold">{kindLabel}</p>
        <ul className="flex flex-col text-callout text-ink-2">
          {changes.map((change, index) => (
            <li key={index}>
              {change.typeLabel}:{" "}
              {change.beforeLabel ? (
                <>
                  <span className="line-through">{change.beforeLabel}</span>{" "}
                  {t("manageVragen.arrow")}{" "}
                </>
              ) : null}
              <span className="font-semibold text-ink">{change.afterLabel ?? "—"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <span />
        <TimelineAxis ticks={axis} />
        <span />
        <DayLine label={t("manageVragen.beforeLabel")} day={before} />
        <DayLine label={t("manageVragen.afterLabel")} day={after} />
      </div>

      {reason ? (
        <div className="flex flex-col gap-1">
          <p className="text-callout text-ink-2">{t("manageVragen.reasonLabel")}</p>
          <p className="text-body">{reason}</p>
        </div>
      ) : null}

      {decision?.note ? (
        <p className="text-callout text-ink-2">
          {t("manageVragen.decidedNote", { note: decision.note })}
        </p>
      ) : null}

      {approveAction && rejectAction ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <form action={approveAction} className="flex">
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="primary" wide>
              {t("manageVragen.approve")}
            </Button>
          </form>
          <Button
            type="button"
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => setRejecting(true)}
          >
            {t("manageVragen.reject")}
          </Button>
          <Sheet
            open={rejecting}
            onClose={() => setRejecting(false)}
            title={t("manageVragen.rejectTitle", { name: employeeName })}
            description={t("manageVragen.rejectBody", { name: employeeName })}
          >
            <form action={rejectAction} className="flex flex-col gap-6">
              <input type="hidden" name="id" value={id} />
              <Field
                id={noteId}
                label={t("manageVragen.rejectNoteLabel")}
                hint={t("manageVragen.rejectNoteHint")}
              >
                <TextInput name="note" required maxLength={280} autoComplete="off" />
              </Field>
              <Button type="submit" variant="destructive" wide>
                {t("manageVragen.rejectConfirm")}
              </Button>
            </form>
          </Sheet>
        </div>
      ) : null}
    </li>
  );
}
