"use client";

import { CheckCircle2, FilePenLine, History, Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import {
  submitCorrectionRequestAction,
  withdrawCorrectionRequestAction,
} from "@/lib/corrections/actions";
import { formatBelgianDateTime, toBrusselsLocalInput } from "@/lib/corrections/format";
import {
  initialCorrectionActionState,
  initialWithdrawalActionState,
  type CorrectionEntry,
  type CorrectionRequestKind,
  type CorrectionRequestStatus,
  type EmployeeCorrectionsView,
} from "@/lib/corrections/model";
import { formatDuration } from "@/lib/time-clock/format";

type Selection = { kind: "missed_entry" } | { entryId: string; kind: "adjustment" };

const inputClassName =
  "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus/30 disabled:opacity-55";

function requestKindLabel(kind: CorrectionRequestKind) {
  return kind === "adjustment"
    ? nlBE.corrections.adjustment
    : nlBE.corrections.missedEntry;
}

function statusLabel(status: CorrectionRequestStatus) {
  return nlBE.corrections.status[status];
}

function CorrectionForm({
  entry,
  kind,
  onCancel,
}: {
  entry: CorrectionEntry | null;
  kind: CorrectionRequestKind;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(
    submitCorrectionRequestAction,
    initialCorrectionActionState,
  );
  const requestIdInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const ensureRequestId = () => {
    if (requestIdInput.current && !requestIdInput.current.value) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  };

  useEffect(() => {
    if (requestIdInput.current) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  }, [entry?.id, kind, state.requestId]);

  const startDefault = entry ? toBrusselsLocalInput(entry.startedAt) : "";
  const endDefault = entry ? toBrusselsLocalInput(entry.endedAt) : "";

  return (
    <section
      aria-labelledby="correction-form-title"
      className="mt-8 border-t border-rule-strong pt-8"
      data-testid="correction-form"
      id="correction-form"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink"
            id="correction-form-title"
            ref={heading}
            tabIndex={-1}
          >
            {requestKindLabel(kind)}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {nlBE.corrections.formHelp}
          </p>
        </div>
        <Button disabled={pending} onClick={onCancel} type="button" variant="quiet">
          <X aria-hidden="true" />
          {nlBE.corrections.cancel}
        </Button>
      </div>

      <form
        action={action}
        aria-busy={pending}
        className="mt-6 grid min-w-0 gap-6"
        onSubmitCapture={ensureRequestId}
        onChange={() => {
          if (requestIdInput.current)
            requestIdInput.current.value = crypto.randomUUID();
        }}
      >
        <input name="request_kind" type="hidden" value={kind} />
        <input name="target_time_entry_id" type="hidden" value={entry?.id ?? ""} />
        <input name="request_id" ref={requestIdInput} type="hidden" />

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <label
              className="block text-sm font-semibold text-ink"
              htmlFor="proposed-start-local"
            >
              {nlBE.corrections.startLabel}
            </label>
            <input
              aria-describedby="correction-time-help proposed-start-error"
              aria-invalid={Boolean(state.fieldErrors?.proposed_start_local)}
              className={inputClassName}
              defaultValue={startDefault}
              disabled={pending}
              id="proposed-start-local"
              inputMode="text"
              name="proposed_start_local"
              pattern={String.raw`[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?`}
              placeholder="dd/mm/jjjj uu:mm"
              required
              type="text"
            />
            <p className="mt-2 text-sm text-danger" id="proposed-start-error">
              {state.fieldErrors?.proposed_start_local ?? ""}
            </p>
          </div>
          <div className="min-w-0">
            <label
              className="block text-sm font-semibold text-ink"
              htmlFor="proposed-end-local"
            >
              {nlBE.corrections.endLabel}
            </label>
            <input
              aria-describedby="correction-time-help proposed-end-error"
              aria-invalid={Boolean(state.fieldErrors?.proposed_end_local)}
              className={inputClassName}
              defaultValue={endDefault}
              disabled={pending}
              id="proposed-end-local"
              inputMode="text"
              name="proposed_end_local"
              pattern={String.raw`[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?`}
              placeholder="dd/mm/jjjj uu:mm"
              required
              type="text"
            />
            <p className="mt-2 text-sm text-danger" id="proposed-end-error">
              {state.fieldErrors?.proposed_end_local ?? ""}
            </p>
          </div>
        </div>

        <p className="-mt-3 text-sm leading-6 text-muted" id="correction-time-help">
          {nlBE.corrections.timeHelp}
        </p>

        <fieldset className="grid min-w-0 gap-5 border-0 p-0 lg:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold text-ink">
            {nlBE.corrections.dstLegend}
          </legend>
          <div className="min-w-0">
            <label
              className="block text-sm font-semibold text-ink"
              htmlFor="proposed-start-occurrence"
            >
              {nlBE.corrections.startOccurrence}
            </label>
            <select
              className={inputClassName}
              defaultValue=""
              disabled={pending}
              id="proposed-start-occurrence"
              aria-invalid={Boolean(state.fieldErrors?.proposed_start_occurrence)}
              aria-describedby="start-occurrence-error"
              name="proposed_start_occurrence"
            >
              <option value="">{nlBE.corrections.occurrenceNotNeeded}</option>
              <option value="earlier">{nlBE.corrections.occurrenceEarlier}</option>
              <option value="later">{nlBE.corrections.occurrenceLater}</option>
            </select>
            <p className="mt-2 text-sm text-danger" id="start-occurrence-error">
              {state.fieldErrors?.proposed_start_occurrence ?? ""}
            </p>
          </div>
          <div className="min-w-0">
            <label
              className="block text-sm font-semibold text-ink"
              htmlFor="proposed-end-occurrence"
            >
              {nlBE.corrections.endOccurrence}
            </label>
            <select
              className={inputClassName}
              defaultValue=""
              disabled={pending}
              id="proposed-end-occurrence"
              aria-invalid={Boolean(state.fieldErrors?.proposed_end_occurrence)}
              aria-describedby="end-occurrence-error"
              name="proposed_end_occurrence"
            >
              <option value="">{nlBE.corrections.occurrenceNotNeeded}</option>
              <option value="earlier">{nlBE.corrections.occurrenceEarlier}</option>
              <option value="later">{nlBE.corrections.occurrenceLater}</option>
            </select>
            <p className="mt-2 text-sm text-danger" id="end-occurrence-error">
              {state.fieldErrors?.proposed_end_occurrence ?? ""}
            </p>
          </div>
        </fieldset>

        <div>
          <label
            className="block text-sm font-semibold text-ink"
            htmlFor="employee-reason"
          >
            {nlBE.corrections.reasonLabel}
          </label>
          <textarea
            aria-describedby="reason-help reason-error"
            aria-invalid={Boolean(state.fieldErrors?.employee_reason)}
            className={`${inputClassName} min-h-28 resize-y`}
            disabled={pending}
            id="employee-reason"
            maxLength={500}
            name="employee_reason"
            required
          />
          <div className="mt-2 flex flex-col gap-1 text-sm sm:flex-row sm:justify-between">
            <p className="text-muted" id="reason-help">
              {nlBE.corrections.reasonHelp}
            </p>
            <p className="text-danger" id="reason-error">
              {state.fieldErrors?.employee_reason ?? ""}
            </p>
          </div>
        </div>

        <Button
          className="w-full sm:w-fit"
          disabled={pending}
          onClick={ensureRequestId}
          size="large"
          type="submit"
        >
          {pending ? nlBE.corrections.submitting : nlBE.corrections.submit}
        </Button>
      </form>

      {state.message ? (
        <p
          className={`mt-5 rounded-xl border px-4 py-3 text-sm leading-6 ${
            state.status === "error"
              ? "border-danger/40 bg-paper text-danger"
              : "border-rule-strong bg-primary-soft text-ink"
          }`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

function WithdrawalControl({ correctionRequestId }: { correctionRequestId: string }) {
  const [state, action, pending] = useActionState(
    withdrawCorrectionRequestAction,
    initialWithdrawalActionState,
  );
  const requestIdInput = useRef<HTMLInputElement>(null);
  const ensureRequestId = () => {
    if (requestIdInput.current && !requestIdInput.current.value) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  };

  useEffect(() => {
    if (requestIdInput.current) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  }, [state.requestId]);

  return (
    <div className="mt-4">
      <form action={action} aria-busy={pending} onSubmitCapture={ensureRequestId}>
        <input name="correction_request_id" type="hidden" value={correctionRequestId} />
        <input name="request_id" ref={requestIdInput} type="hidden" />
        <Button
          disabled={pending}
          onClick={ensureRequestId}
          type="submit"
          variant="secondary"
        >
          {pending ? nlBE.corrections.withdrawing : nlBE.corrections.withdraw}
        </Button>
      </form>
      {state.message ? (
        <p
          className={`mt-3 text-sm leading-6 ${
            state.status === "error" ? "text-danger" : "text-ink"
          }`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function CorrectionRequestPanel({
  view,
}: {
  view: EmployeeCorrectionsView | null;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const initiatingControl = useRef<HTMLButtonElement | null>(null);

  if (!view) {
    return (
      <div className="mt-8 rounded-2xl border border-danger/40 bg-paper p-6">
        <p className="font-semibold text-danger" role="alert">
          {nlBE.corrections.loadFailure}
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <Link href="/employee/corrections">{nlBE.corrections.retry}</Link>
        </Button>
      </div>
    );
  }

  const selectedEntry =
    selection?.kind === "adjustment"
      ? (view.entries.find((entry) => entry.id === selection.entryId) ?? null)
      : null;
  return (
    <div className="mt-8 min-w-0">
      <div className="flex flex-col gap-3 border-b border-rule-strong pb-6 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="quiet">
          <Link href="/employee">
            <History aria-hidden="true" />
            {nlBE.corrections.backToClock}
          </Link>
        </Button>
        <Button
          aria-expanded={selection?.kind === "missed_entry"}
          aria-controls={selection ? "correction-form" : undefined}
          className="h-auto w-full py-3 text-center leading-5 whitespace-normal sm:w-auto"
          onClick={(event) => {
            initiatingControl.current = event.currentTarget;
            setSelection({ kind: "missed_entry" });
            document.getElementById("correction-form-title")?.focus();
          }}
          type="button"
        >
          <Plus aria-hidden="true" />
          {nlBE.corrections.reportMissed}
        </Button>
      </div>

      <section aria-labelledby="closed-entries-title" className="mt-8">
        <div className="flex items-end justify-between gap-4 border-b border-rule pb-3">
          <div>
            <h2
              className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink"
              id="closed-entries-title"
            >
              {nlBE.corrections.closedEntries}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {nlBE.corrections.closedEntriesHelp}
            </p>
          </div>
          <span className="font-display text-2xl font-semibold text-primary">
            {view.entries.length}
          </span>
        </div>

        {view.entries.length === 0 ? (
          <p className="py-8 text-muted">{nlBE.corrections.noClosedEntries}</p>
        ) : (
          <ol className="divide-y divide-rule" data-testid="closed-entries">
            {view.entries.map((entry) => (
              <li
                className="flex min-w-0 flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
                key={entry.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0 text-muted"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {formatBelgianDateTime(entry.startedAt)}
                      <span aria-hidden="true"> – </span>
                      {formatBelgianDateTime(entry.endedAt)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {nlBE.timeClock.duration}{" "}
                      {formatDuration(entry.startedAt, entry.endedAt)}
                    </p>
                  </div>
                </div>
                <Button
                  aria-expanded={
                    selection?.kind === "adjustment" && selection.entryId === entry.id
                  }
                  aria-controls={selection ? "correction-form" : undefined}
                  className="w-full shrink-0 sm:w-auto"
                  onClick={(event) => {
                    initiatingControl.current = event.currentTarget;
                    setSelection({ entryId: entry.id, kind: "adjustment" });
                    document.getElementById("correction-form-title")?.focus();
                  }}
                  type="button"
                  variant="secondary"
                >
                  <FilePenLine aria-hidden="true" />
                  {nlBE.corrections.requestCorrection}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {selection ? (
        <CorrectionForm
          entry={selectedEntry}
          key={
            selection.kind === "adjustment"
              ? `adjustment-${selection.entryId}`
              : "missed-entry"
          }
          kind={selection.kind}
          onCancel={() => {
            setSelection(null);
            initiatingControl.current?.focus();
          }}
        />
      ) : null}

      <section aria-labelledby="requests-title" className="mt-10">
        <div className="border-b border-rule-strong pb-3">
          <h2
            className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink"
            id="requests-title"
          >
            {nlBE.corrections.myRequests}
          </h2>
          <p className="mt-1 text-sm text-muted">{nlBE.corrections.myRequestsHelp}</p>
        </div>

        {view.requests.length === 0 ? (
          <p className="py-8 text-muted">{nlBE.corrections.noRequests}</p>
        ) : (
          <ol className="divide-y divide-rule" data-testid="correction-requests">
            {view.requests.map((request) => (
              <li className="min-w-0 py-6" key={request.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {requestKindLabel(request.requestKind)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {formatBelgianDateTime(request.proposedStartedAt)}
                      <span aria-hidden="true"> – </span>
                      {formatBelgianDateTime(request.proposedEndedAt)}
                    </p>
                  </div>
                  <span className="w-fit shrink-0 rounded-full border border-rule-strong bg-signal-soft px-3 py-1 text-xs font-semibold text-signal-ink">
                    {statusLabel(request.status)}
                  </span>
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 break-words whitespace-pre-wrap text-ink">
                  {request.employeeReason}
                </p>
                {request.resolvedAt ? (
                  <p className="mt-3 text-sm text-muted">
                    {nlBE.managerCorrections.resolved}:{" "}
                    {formatBelgianDateTime(request.resolvedAt)}
                  </p>
                ) : null}
                {request.managerNote ? (
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-ink">
                      {nlBE.managerCorrections.note}
                    </p>
                    <p className="mt-1 max-w-3xl text-sm leading-6 break-words whitespace-pre-wrap text-ink">
                      {request.managerNote}
                    </p>
                  </div>
                ) : null}
                {request.status === "pending" ? (
                  <WithdrawalControl correctionRequestId={request.id} />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
