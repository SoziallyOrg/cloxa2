"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { formatBelgianDateTime, toBrusselsLocalInput } from "@/lib/corrections/format";
import { decideCorrectionRequestAction } from "@/lib/manager-corrections/actions";
import type {
  DecisionActionState,
  ManagerCorrectionRequest,
  ManagerCorrectionsView,
} from "@/lib/manager-corrections/model";

const copy = nlBE.managerCorrections;
const offsetFormatter = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  timeZoneName: "shortOffset",
});
function exactTime(value: string) {
  const offset = offsetFormatter
    .formatToParts(new Date(value))
    .find((part) => part.type === "timeZoneName")?.value;
  return `${toBrusselsLocalInput(value)} (${offset})`;
}
function Interval({ start, end }: { start: string; end: string }) {
  return (
    <p className="mt-2 flex flex-col gap-1 text-sm leading-6 text-ink tabular-nums">
      <time dateTime={start}>{exactTime(start)}</time>
      <span>
        <span aria-hidden="true">– </span>
        <time dateTime={end}>{exactTime(end)}</time>
      </span>
    </p>
  );
}

export function ManagerCorrectionPanel({
  view,
}: {
  view: ManagerCorrectionsView | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initiatingControl = useRef<HTMLButtonElement | null>(null);
  const feedbackControl = useRef<HTMLParagraphElement>(null);
  const dialogFeedback = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const [selection, setSelection] = useState<{
    request: ManagerCorrectionRequest;
    decision: "approve" | "reject";
  } | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<DecisionActionState>({
    status: "idle",
    message: "",
  });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (selection && !dialog.current?.open) dialog.current?.showModal();
  }, [selection]);
  useEffect(() => {
    if (feedback.status !== "idle") {
      if (selection) dialogFeedback.current?.focus();
      else feedbackControl.current?.focus();
    }
  }, [feedback, selection]);

  function closeDialog() {
    if (busy.current) return;
    dialog.current?.close();
    setSelection(null);
    setFeedback({ status: "idle", message: "" });
    initiatingControl.current?.focus();
  }
  function openDecision(
    request: ManagerCorrectionRequest,
    decision: "approve" | "reject",
    control: HTMLButtonElement,
  ) {
    initiatingControl.current = control;
    operation.current = null;
    setNote("");
    setFeedback({ status: "idle", message: "" });
    setSelection({ request, decision });
  }
  function requestRow(request: ManagerCorrectionRequest) {
    return (
      <li
        className="min-w-0 border-b border-rule"
        key={request.id}
        data-testid={`review-${request.id}`}
      >
        <details className="group py-5">
          <summary className="cursor-pointer rounded-lg text-ink outline-none focus-visible:ring-3 focus-visible:ring-focus">
            <span className="ml-2 font-semibold break-words">
              {request.employeeDisplayName || copy.employeeFallback}
            </span>
            <span className="mt-1 block pl-6 text-sm leading-6 break-words text-muted">
              {request.employeeCode || copy.codeFallback} ·{" "}
              {request.requestKind === "adjustment"
                ? nlBE.corrections.adjustment
                : nlBE.corrections.missedEntry}
            </span>
            <span className="mt-2 ml-6 inline-block rounded-full border border-rule-strong bg-signal-soft px-3 py-1 text-xs font-semibold text-signal-ink">
              {nlBE.corrections.status[request.status]}
            </span>
          </summary>
          <div className="mt-5 min-w-0">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 bg-paper-strong p-4">
                <h3 className="font-semibold text-ink">{copy.original}</h3>
                {request.originalStartedAt && request.originalEndedAt ? (
                  <Interval
                    start={request.originalStartedAt}
                    end={request.originalEndedAt}
                  />
                ) : (
                  <p className="mt-2 text-sm leading-6 text-muted">{copy.noOriginal}</p>
                )}
              </div>
              <div className="min-w-0 bg-primary-soft p-4">
                <h3 className="font-semibold text-primary-strong">{copy.proposal}</h3>
                <Interval
                  start={request.proposedStartedAt}
                  end={request.proposedEndedAt}
                />
              </div>
            </div>
            <h3 className="mt-5 text-sm font-semibold text-ink">{copy.reason}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 break-words whitespace-pre-wrap text-ink">
              {request.employeeReason}
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              {copy.submitted}:{" "}
              <time dateTime={request.createdAt}>
                {formatBelgianDateTime(request.createdAt)}
              </time>
            </p>
            {request.resolvedAt ? (
              <p className="mt-1 text-sm leading-6 text-muted">
                {copy.resolved}:{" "}
                <time dateTime={request.resolvedAt}>
                  {formatBelgianDateTime(request.resolvedAt)}
                </time>
              </p>
            ) : null}
            {request.managerNote ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-ink">{copy.note}</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 break-words whitespace-pre-wrap text-ink">
                  {request.managerNote}
                </p>
              </div>
            ) : null}
            {request.status === "pending" ? (
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button
                  disabled={pending}
                  onClick={(event) =>
                    openDecision(request, "approve", event.currentTarget)
                  }
                >
                  {copy.approve}
                </Button>
                <Button
                  disabled={pending}
                  variant="secondary"
                  onClick={(event) =>
                    openDecision(request, "reject", event.currentTarget)
                  }
                >
                  {copy.reject}
                </Button>
              </div>
            ) : null}
          </div>
        </details>
      </li>
    );
  }

  return (
    <div className="mt-6 min-w-0">
      <Button asChild variant="quiet">
        <Link href="/manager">{copy.back}</Link>
      </Button>
      <p className="mt-4 text-sm leading-6 text-muted">{copy.timezone}</p>
      {feedback.message && !selection ? (
        <p
          ref={feedbackControl}
          tabIndex={-1}
          role={feedback.status === "error" ? "alert" : "status"}
          className="mt-5 rounded-xl border border-rule-strong bg-primary-soft p-4 text-sm leading-6 text-ink"
        >
          {feedback.message}
        </p>
      ) : null}
      {!view ? (
        <div className="mt-6">
          <p role="alert" className="text-danger">
            {copy.loadFailure}
          </p>
          <Button
            className="mt-4"
            onClick={() => window.location.reload()}
            variant="secondary"
          >
            {copy.reload}
          </Button>
        </div>
      ) : (
        <>
          <section className="mt-8" aria-labelledby="pending-title">
            <h2
              id="pending-title"
              className="border-b border-rule-strong pb-3 font-display text-3xl font-semibold text-ink"
            >
              {copy.pending} <span className="text-muted">({view.pendingCount})</span>
            </h2>
            {view.pendingCount === 0 ? (
              <p className="py-6 text-muted">{copy.empty}</p>
            ) : (
              <ol data-testid="review-pending">
                {view.requests
                  .filter((request) => request.status === "pending")
                  .map(requestRow)}
              </ol>
            )}
          </section>
          <section className="mt-10" aria-labelledby="review-history-title">
            <h2
              id="review-history-title"
              className="border-b border-rule-strong pb-3 font-display text-3xl font-semibold text-ink"
            >
              {copy.history}
            </h2>
            <p className="mt-2 text-sm text-muted">{copy.historyHelp}</p>
            {view.requests.every((request) => request.status === "pending") ? (
              <p className="py-6 text-muted">{copy.noHistory}</p>
            ) : (
              <ol data-testid="review-history">
                {view.requests
                  .filter((request) => request.status !== "pending")
                  .map(requestRow)}
              </ol>
            )}
          </section>
        </>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="decision-title"
        aria-describedby="decision-help"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-rule-strong bg-paper p-4 text-ink backdrop:bg-ink/40 sm:p-6"
      >
        {selection ? (
          <form
            noValidate
            aria-busy={pending}
            data-testid="decision-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy.current) return;
              busy.current = true;
              const signature = JSON.stringify([
                selection.request.id,
                selection.decision,
                note,
              ]);
              if (operation.current?.signature !== signature)
                operation.current = { signature, id: crypto.randomUUID() };
              const form = new FormData();
              form.set("request_id", operation.current.id);
              form.set("correction_request_id", selection.request.id);
              form.set("decision", selection.decision);
              form.set("manager_note", note);
              startTransition(async () => {
                let result: DecisionActionState;
                try {
                  result = await decideCorrectionRequestAction(form);
                } catch {
                  result = { status: "error", message: copy.failure };
                }
                busy.current = false;
                setFeedback(result);
                if (result.status === "success") {
                  dialog.current?.close();
                  setSelection(null);
                }
              });
            }}
          >
            <h2 id="decision-title" className="font-display text-3xl font-semibold">
              {selection.decision === "approve" ? copy.confirmTitle : copy.rejectTitle}
            </h2>
            <p id="decision-help" className="mt-3 text-sm leading-6 text-muted">
              {selection.decision === "approve" ? copy.confirmHelp : copy.rejectHelp}
            </p>
            <p className="mt-4 font-semibold break-words">
              {selection.request.employeeDisplayName || copy.employeeFallback}
            </p>
            <Interval
              start={selection.request.proposedStartedAt}
              end={selection.request.proposedEndedAt}
            />
            <fieldset disabled={pending} className="mt-5 min-w-0">
              <label htmlFor="manager-note" className="block text-sm font-semibold">
                {selection.decision === "reject"
                  ? copy.requiredNote
                  : copy.optionalNote}
              </label>
              <textarea
                id="manager-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required={selection.decision === "reject"}
                maxLength={500}
                aria-invalid={Boolean(feedback.noteError)}
                aria-describedby={`manager-note-help${feedback.noteError ? " manager-note-error" : ""}`}
                className="mt-2 min-h-28 w-full min-w-0 resize-y rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base outline-none focus:border-focus focus:ring-3 focus:ring-focus/30 disabled:opacity-55"
              />
              <p id="manager-note-help" className="mt-1 text-sm leading-6 text-muted">
                {copy.noteHelp}
              </p>
              {feedback.noteError ? (
                <p id="manager-note-error" className="mt-2 text-sm text-danger">
                  {feedback.noteError}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
                <Button type="submit" className="h-auto min-h-11 whitespace-normal">
                  {pending
                    ? copy.working
                    : selection.decision === "approve"
                      ? copy.confirmApprove
                      : copy.confirmReject}
                </Button>
                <Button type="button" variant="secondary" onClick={closeDialog}>
                  {copy.cancel}
                </Button>
              </div>
            </fieldset>
            {feedback.message ? (
              <p
                ref={dialogFeedback}
                tabIndex={-1}
                role={feedback.status === "error" ? "alert" : "status"}
                className="mt-4 text-sm leading-6 text-danger"
              >
                {feedback.message}
              </p>
            ) : null}
            <p role="status" className="sr-only">
              {pending ? copy.working : ""}
            </p>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
