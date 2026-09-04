"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import {
  createTimeExportAction,
  previewTimeExportAction,
} from "@/lib/time-exports/actions";
import {
  formatExactDuration,
  type ExportActionState,
  type TimeExportManifest,
  type TimeExportPreview,
} from "@/lib/time-exports/model";

const copy = nlBE.managerExports;

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function DownloadControls({ manifest }: { manifest: TimeExportManifest }) {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      {(["csv", "json"] as const).map((format) => (
        <Button
          asChild
          key={format}
          variant={format === "csv" ? "primary" : "secondary"}
        >
          <a
            href={`/manager/exports/${manifest.exportId}/${format}`}
            download
            className="h-auto min-h-11 whitespace-normal"
          >
            {format === "csv" ? copy.downloadCsv : copy.downloadJson}
          </a>
        </Button>
      ))}
    </div>
  );
}

function ManifestSummary({ manifest }: { manifest: TimeExportManifest }) {
  return (
    <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="font-semibold text-muted">{copy.period}</dt>
        <dd className="mt-1 break-words text-ink tabular-nums">
          {manifest.periodStartLocal} – {manifest.periodEndLocal}
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-muted">{copy.createdAt}</dt>
        <dd className="mt-1 break-words text-ink tabular-nums">
          <time dateTime={manifest.createdAtUtc}>
            {new Intl.DateTimeFormat("nl-BE", {
              dateStyle: "medium",
              timeStyle: "medium",
              timeZone: "Europe/Brussels",
            }).format(new Date(manifest.createdAtUtc))}
          </time>
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-muted">{copy.counts}</dt>
        <dd className="mt-1 text-ink">
          {manifest.recordCount} · {manifest.employeeCount}
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-muted">{copy.schema}</dt>
        <dd className="mt-1 break-all text-ink">{manifest.schemaVersion}</dd>
      </div>
      <div className="min-w-0 sm:col-span-2 lg:col-span-4">
        <dt className="font-semibold text-muted">{copy.datasetHash}</dt>
        <dd className="mt-1 font-mono text-xs break-all text-ink">
          {manifest.datasetSha256}
        </dd>
      </div>
    </dl>
  );
}

function PreviewSummary({ preview }: { preview: TimeExportPreview }) {
  const [showRecords, setShowRecords] = useState(false);
  return (
    <section className="mt-6 border-y border-rule bg-paper-strong px-4 py-5 sm:px-5">
      <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">
        {copy.previewTitle}
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm font-semibold text-muted">{copy.records}</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">
            {preview.recordCount}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">{copy.employees}</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">
            {preview.employeeCount}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">{copy.total}</dt>
          <dd className="mt-1 text-xl font-semibold break-words text-ink tabular-nums">
            {formatExactDuration(preview.totalDurationMicroseconds)}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-6 break-words text-muted">
        {copy.utcWindow} {preview.utcStartInclusive} – {preview.utcEndExclusive}
      </p>
      {preview.blockers.length ? (
        <div className="mt-5" data-testid="export-blockers">
          <h3 className="font-semibold text-danger">{copy.blockersTitle}</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-ink">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>
                {
                  copy.blockers[
                    blocker === "break_data_requires_v2"
                      ? "breakDataRequiresV2"
                      : blocker === "no_records"
                        ? "noRecords"
                        : blocker === "open_entry"
                          ? "openEntry"
                          : blocker === "pending_correction"
                            ? "pendingCorrection"
                            : blocker === "row_limit"
                              ? "rowLimit"
                              : "artifactTooLarge"
                  ]
                }
                {blocker === "pending_correction" ? (
                  <>
                    {" "}
                    <Link
                      className="font-semibold text-primary underline"
                      href="/manager/corrections"
                    >
                      {copy.openCorrections}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="mt-5">
          <h3 className="font-semibold text-signal-ink">{copy.warningsTitle}</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-ink">
            {preview.warnings.map((warning) => (
              <li key={warning}>
                {warning === "missing_employee_code"
                  ? copy.warnings.missingEmployeeCode
                  : copy.warnings.missingDisplayName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.records.length ? (
        <details
          className="mt-5 min-w-0"
          onToggle={(event) => setShowRecords(event.currentTarget.open)}
        >
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {copy.previewRecords}
          </summary>
          <p className="my-3 text-sm leading-6 text-muted">{copy.previewRecordsHelp}</p>
          {showRecords ? (
            <ol
              className="max-h-96 min-w-0 space-y-4 overflow-y-auto"
              tabIndex={0}
              aria-label={copy.previewRecords}
            >
              {preview.records.map((record) => (
                <li
                  key={record.sourceTimeEntryId}
                  className="min-w-0 border-t border-rule py-4 text-sm leading-6 break-words"
                >
                  <p className="font-semibold">
                    {record.rowOrdinal}.{" "}
                    {record.employeeDisplayName ?? copy.missingName}
                  </p>
                  <p>
                    {record.employeeCode ?? copy.missingCode} · {record.worksiteName}
                  </p>
                  <dl className="mt-2 space-y-2">
                    <div>
                      <dt className="font-semibold">{copy.sourceVersion}</dt>
                      <dd className="break-all">
                        {record.sourceTimeEntryId} / {record.sourceTimeEntryVersion}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{copy.factualInterval}</dt>
                      <dd>
                        <time>{record.startedAtBrussels}</time>
                        <br />
                        <time>{record.endedAtBrussels}</time>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{copy.total}</dt>
                      <dd>{formatExactDuration(record.durationMicroseconds)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{copy.factualOrigin}</dt>
                      <dd>
                        {record.factualOrigin === "clock"
                          ? copy.originClock
                          : copy.originMissed}
                      </dd>
                    </div>
                    {record.lastCorrectionRequestId ? (
                      <div>
                        <dt className="font-semibold">{copy.lastCorrection}</dt>
                        <dd className="break-all">{record.lastCorrectionRequestId}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

export function ManagerExportPanel({
  history,
}: {
  history: TimeExportManifest[] | null;
}) {
  const router = useRouter();
  const [today] = useState(() => localToday());
  const [start, setStart] = useState(() => shiftDate(today, -6));
  const [end, setEnd] = useState(today);
  const [preview, setPreview] = useState<TimeExportPreview | null>(null);
  const [created, setCreated] = useState<TimeExportManifest | null>(null);
  const [feedback, setFeedback] = useState<ExportActionState>({
    status: "idle",
    message: "",
  });
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  const dialogFeedback = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);

  useEffect(() => {
    if (feedback.message)
      (dialog.current?.open
        ? dialogFeedback.current
        : feedbackElement.current
      )?.focus();
  }, [feedback]);

  function updatePeriod(nextStart: string, nextEnd: string) {
    setStart(nextStart);
    setEnd(nextEnd);
    setPreview(null);
    setCreated(null);
    setFeedback({ status: "idle", message: "" });
    operation.current = null;
  }

  function closeDialog() {
    if (busy.current) return;
    dialog.current?.close();
    dialogFeedback.current = null;
    confirmButton.current?.focus();
  }

  return (
    <div className="mt-6 min-w-0">
      <Button asChild variant="quiet">
        <Link href="/manager">{copy.back}</Link>
      </Button>
      <p
        id="export-period-help"
        className="mt-4 max-w-3xl text-sm leading-6 text-muted"
      >
        {copy.periodHelp}
      </p>
      <form
        aria-busy={pending}
        className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2 lg:max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy.current) return;
          busy.current = true;
          const form = new FormData();
          form.set("period_start_local", start);
          form.set("period_end_local", end);
          startTransition(async () => {
            let result: ExportActionState;
            try {
              result = await previewTimeExportAction(form);
            } catch {
              result = { status: "error", message: copy.previewFailure };
            }
            busy.current = false;
            setFeedback(result);
            setPreview(result.preview ?? null);
            setCreated(null);
            operation.current = null;
          });
        }}
      >
        <label className="min-w-0 text-sm font-semibold text-ink">
          {copy.startLabel}
          <input
            type="date"
            aria-describedby="export-period-help"
            required
            max={today}
            value={start}
            onChange={(event) => updatePeriod(event.target.value, end)}
            disabled={pending}
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base outline-none focus:border-focus focus:ring-3 focus:ring-focus/30 disabled:opacity-55"
          />
        </label>
        <label className="min-w-0 text-sm font-semibold text-ink">
          {copy.endLabel}
          <input
            type="date"
            aria-describedby="export-period-help"
            required
            max={today}
            value={end}
            onChange={(event) => updatePeriod(start, event.target.value)}
            disabled={pending}
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base outline-none focus:border-focus focus:ring-3 focus:ring-focus/30 disabled:opacity-55"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? copy.previewing : copy.preview}
          </Button>
        </div>
      </form>
      {feedback.message ? (
        <p
          ref={feedbackElement}
          tabIndex={-1}
          role={feedback.status === "error" ? "alert" : "status"}
          className={`mt-5 rounded-xl border border-rule-strong p-4 text-sm leading-6 ${feedback.status === "error" ? "bg-paper text-danger" : "bg-primary-soft text-ink"}`}
        >
          {feedback.message}
        </p>
      ) : null}
      {preview ? (
        <>
          <PreviewSummary preview={preview} />
          {!preview.blockers.length ? (
            <Button
              type="button"
              className="mt-6 h-auto min-h-11 w-full whitespace-normal sm:w-auto"
              onClick={(event) => {
                confirmButton.current = event.currentTarget;
                setFeedback({ status: "idle", message: "" });
                dialog.current?.showModal();
              }}
              disabled={pending}
            >
              {copy.confirm}
            </Button>
          ) : null}
        </>
      ) : null}
      {created ? (
        <section
          className="mt-8 border-t border-rule pt-7"
          data-testid="created-export"
        >
          <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">
            {copy.readyTitle}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">{copy.readyHelp}</p>
          <ManifestSummary manifest={created} />
          <DownloadControls manifest={created} />
        </section>
      ) : null}
      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
          {copy.historyTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">{copy.historyHelp}</p>
        {history === null ? (
          <p role="alert" className="mt-5 text-sm leading-6 text-danger">
            {copy.historyFailure}
          </p>
        ) : history.length === 0 ? (
          <p className="mt-5 text-muted">{copy.noHistory}</p>
        ) : (
          <ol className="mt-5 divide-y divide-rule" data-testid="export-history">
            {history.map((manifest) => (
              <li className="min-w-0 py-6 first:pt-0" key={manifest.exportId}>
                <ManifestSummary manifest={manifest} />
                <DownloadControls manifest={manifest} />
              </li>
            ))}
          </ol>
        )}
      </section>
      <dialog
        ref={dialog}
        aria-labelledby="export-confirm-title"
        aria-describedby="export-confirm-help"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-rule-strong bg-paper p-4 text-ink backdrop:bg-ink/40 sm:p-6"
      >
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (!preview || busy.current) return;
            busy.current = true;
            const signature = JSON.stringify([start, end, true]);
            if (operation.current?.signature !== signature)
              operation.current = { signature, id: crypto.randomUUID() };
            const form = new FormData();
            form.set("request_id", operation.current.id);
            form.set("period_start_local", start);
            form.set("period_end_local", end);
            form.set("confirmed", "true");
            startTransition(async () => {
              let result: ExportActionState;
              try {
                result = await createTimeExportAction(form);
              } catch {
                result = { status: "error", message: copy.createFailure };
              }
              busy.current = false;
              setFeedback(result);
              if (result.status === "success" && result.manifest) {
                setCreated(result.manifest);
                dialog.current?.close();
                setPreview(null);
                router.refresh();
              }
            });
          }}
        >
          <h2 id="export-confirm-title" className="font-display text-3xl font-semibold">
            {copy.confirmTitle}
          </h2>
          <p id="export-confirm-help" className="mt-3 text-sm leading-6 text-muted">
            {copy.confirmHelp}
          </p>
          <p className="mt-4 font-semibold break-words tabular-nums">
            {start} – {end}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
            <Button
              type="submit"
              disabled={pending}
              className="h-auto min-h-11 whitespace-normal"
            >
              {pending ? copy.creating : copy.confirmCreate}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeDialog}
            >
              {copy.cancel}
            </Button>
          </div>
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
            {pending ? copy.creating : ""}
          </p>
        </form>
      </dialog>
    </div>
  );
}
