"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { RequestCorrectionInput } from "@cloxa/db";

import type { CorrectionDay } from "@/lib/corrections/days";
import {
  buildCorrectionPayload,
  canAdvance,
  goBack,
  goNext,
  INITIAL_CORRECTION_FORM_STATE,
  type CorrectionEventType,
  type CorrectionFormState,
  type CorrectionKind,
} from "@/lib/corrections/form";

import { Alert } from "../ui/Alert";
import { Button, buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { Field } from "../ui/Field";
import { GroupedList, ListButtonRow } from "../ui/GroupedList";
import { IconCheck } from "../ui/icons";
import { TextInput } from "../ui/TextInput";

export interface CorrectionFormProps {
  siteId: string;
  /** The last 14 days, newest first, each with its events. */
  days: readonly CorrectionDay[];
  /** Set when started from a day or shift ("Klopt er iets niet?"): no day list then. */
  preselectedDate: string | null;
  submitAction: (
    input: RequestCorrectionInput,
  ) => Promise<{ ok: boolean; errorKey?: string }>;
}

type Key = Parameters<typeof t>[0];

const KIND_OPTIONS: readonly { kind: CorrectionKind; labelKey: Key }[] = [
  { kind: "add", labelKey: "correctionForm.kindAdd" },
  { kind: "adjust", labelKey: "correctionForm.kindAdjust" },
  { kind: "remove", labelKey: "correctionForm.kindRemove" },
];

const EVENT_TYPE_OPTIONS: readonly { type: CorrectionEventType; labelKey: Key }[] = [
  { type: "clock_in", labelKey: "correctionForm.eventTypeClockIn" },
  { type: "clock_out", labelKey: "correctionForm.eventTypeClockOut" },
  { type: "break_start", labelKey: "correctionForm.eventTypeBreakStart" },
  { type: "break_end", labelKey: "correctionForm.eventTypeBreakEnd" },
];

const KIND_LABEL_KEY: Record<CorrectionKind, Key> = {
  add: "correctionForm.kindAdd",
  adjust: "correctionForm.kindAdjust",
  remove: "correctionForm.kindRemove",
};

/** Three dots plus "Stap 1 van 3": where you are in the wizard. */
function StepDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex gap-1.5">
        {[1, 2, 3].map((dot) => (
          <span
            key={dot}
            className={cx(
              "size-2 rounded-full",
              dot === step ? "bg-ink" : dot < step ? "bg-ink-3" : "bg-line",
            )}
          />
        ))}
      </span>
      <p className="text-callout text-ink-2">{t("correctionForm.stepOf", { step })}</p>
    </div>
  );
}

/** A big choice row: the whole row is the button; the chosen one gets a check. */
function Choice({
  label,
  time,
  spoken,
  selected,
  onSelect,
}: {
  label: string;
  /** Right-aligned, e.g. "08:02". */
  time?: string;
  /** The accessible name when a time is shown: "Gestopt met werken om 16:31". */
  spoken?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListButtonRow
      aria-pressed={selected}
      {...(spoken ? { "aria-label": spoken } : {})}
      title={<span className={selected ? "font-semibold" : undefined}>{label}</span>}
      value={
        <span className="flex items-center gap-3">
          {time ? (
            <span className={cx("tabular-nums", selected ? "text-ink" : "text-ink-2")}>
              {time}
            </span>
          ) : null}
          {selected ? (
            <IconCheck className="size-5 text-ink" strokeWidth={2.5} />
          ) : (
            <span className="block size-5" />
          )}
        </span>
      }
      onClick={onSelect}
    />
  );
}

/**
 * "Klopt er iets niet?" in three steps, one question per screen: what is
 * wrong, which moment, and why. The step logic lives in `lib/corrections/form`.
 */
export function CorrectionForm({
  siteId,
  days,
  preselectedDate,
  submitAction,
}: CorrectionFormProps) {
  const router = useRouter();
  const [state, setState] = useState<CorrectionFormState>({
    ...INITIAL_CORRECTION_FORM_STATE,
    date: preselectedDate ?? days[0]?.key ?? "",
  });
  // Step 2 starts with "Welke dag?" unless the day came with the link.
  const [dayChosen, setDayChosen] = useState(preselectedDate !== null);
  const day = days.find((candidate) => candidate.key === state.date);
  const targets = day?.targets ?? [];
  const choosingDay = state.step === 2 && !dayChosen;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const payload = useMemo(() => buildCorrectionPayload(state, siteId), [state, siteId]);

  if (done) {
    return (
      <div className="flex flex-1 flex-col gap-8">
        <Alert tone="success">{t("correctionForm.submitted")}</Alert>
        <Link
          href="/app/vragen"
          className={cx(buttonClassName("secondary", "md", true), "mt-auto")}
        >
          {t("correctionForm.toQuestions")}
        </Link>
      </div>
    );
  }

  async function handleSubmit() {
    if (payload === null) return;
    const toSubmit = payload;
    setSubmitting(true);
    setError(null);
    const result = await submitAction(toSubmit);
    setSubmitting(false);
    if (!result.ok) {
      setError(t((result.errorKey as Key) ?? "correctionForm.genericError"));
      return;
    }
    setDone(true);
    router.refresh();
  }

  const title =
    state.step === 1
      ? t("correctionForm.step1Title")
      : choosingDay
        ? t("correctionForm.dayTitle")
        : state.step === 2
          ? state.kind === "remove"
            ? t("correctionForm.step2TitleRemove")
            : t("correctionForm.step2Title")
          : t("correctionForm.step3Title");

  function back() {
    if (state.step === 2 && dayChosen && preselectedDate === null) {
      setDayChosen(false);
      return;
    }
    setState(goBack);
  }

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-col gap-4">
        <StepDots step={state.step} />
        <h1 className="text-title">{title}</h1>
        {state.step === 2 && !choosingDay && day ? (
          <p className="text-body text-ink-2">{day.longLabel}</p>
        ) : null}
      </div>

      {state.step === 1 ? (
        <GroupedList>
          {KIND_OPTIONS.map((option) => (
            <Choice
              key={option.kind}
              label={t(option.labelKey)}
              selected={state.kind === option.kind}
              onSelect={() =>
                setState((current) => ({
                  ...current,
                  kind: option.kind,
                  targetEventId: null,
                }))
              }
            />
          ))}
        </GroupedList>
      ) : null}

      {choosingDay ? (
        <GroupedList>
          {days.map((candidate) => (
            <ListButtonRow
              key={candidate.key}
              aria-label={`${candidate.label}, ${candidate.summary}`}
              title={candidate.label}
              detail={candidate.summary}
              chevron
              onClick={() => {
                setState((current) => ({
                  ...current,
                  date: candidate.key,
                  targetEventId: null,
                }));
                setDayChosen(true);
              }}
            />
          ))}
        </GroupedList>
      ) : null}

      {state.step === 2 && !choosingDay ? (
        <div className="flex flex-col gap-8">
          {state.kind === "add" ? (
            <GroupedList heading={t("correctionForm.eventTypeLabel")}>
              {EVENT_TYPE_OPTIONS.map((option) => (
                <Choice
                  key={option.type}
                  label={t(option.labelKey)}
                  selected={state.eventType === option.type}
                  onSelect={() =>
                    setState((current) => ({ ...current, eventType: option.type }))
                  }
                />
              ))}
            </GroupedList>
          ) : targets.length === 0 ? (
            <p className="text-body text-ink-2">{t("correctionForm.noTargets")}</p>
          ) : (
            <GroupedList heading={t("correctionForm.targetLabel")}>
              {targets.map((target) => {
                const label = t(
                  EVENT_TYPE_OPTIONS.find((option) => option.type === target.type)
                    ?.labelKey ?? "correctionForm.eventTypeClockIn",
                );
                const time = formatBrusselsTime(new Date(target.occurredAtIso));
                return (
                  <Choice
                    key={target.id}
                    label={label}
                    time={time}
                    spoken={t("correctionForm.targetOption", { type: label, time })}
                    selected={state.targetEventId === target.id}
                    onSelect={() =>
                      setState((current) => ({ ...current, targetEventId: target.id }))
                    }
                  />
                );
              })}
            </GroupedList>
          )}

          {state.kind === "add" || (state.kind === "adjust" && targets.length > 0) ? (
            <div className="sm:max-w-60">
              <Field
                id="time"
                label={
                  state.kind === "add"
                    ? t("correctionForm.timeLabel")
                    : t("correctionForm.newTimeLabel")
                }
              >
                <TextInput
                  type="time"
                  value={state.time}
                  onChange={(event) =>
                    setState((current) => ({ ...current, time: event.target.value }))
                  }
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.step === 3 ? (
        <div className="flex flex-col gap-8">
          <Field
            id="reason"
            label={t("correctionForm.reasonLabel")}
            hint={t("correctionForm.reasonHint")}
            optional
          >
            <TextInput
              value={state.reason}
              maxLength={280}
              onChange={(event) =>
                setState((current) => ({ ...current, reason: event.target.value }))
              }
            />
          </Field>

          <section className="flex flex-col gap-2">
            <h2 className="px-4 text-callout font-normal text-ink-2">
              {t("correctionForm.summaryTitle")}
            </h2>
            <div className="flex flex-col gap-1 rounded-group bg-fill px-4 py-3.5 text-body">
              <p>
                {t("correctionForm.summaryKind", {
                  value: t(KIND_LABEL_KEY[state.kind ?? "add"]),
                })}
              </p>
              <p className="text-ink-2">
                {state.reason.trim()
                  ? t("correctionForm.summaryReason", { value: state.reason.trim() })
                  : t("correctionForm.summaryNoReason")}
              </p>
            </div>
          </section>
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {error ? (
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {state.step === 3 ? (
          <Button
            size="lg"
            loading={submitting}
            disabled={payload === null}
            onClick={() => void handleSubmit()}
          >
            {t("correctionForm.submit")}
          </Button>
        ) : choosingDay ? null : (
          <Button
            size="lg"
            disabled={!canAdvance(state, targets)}
            onClick={() => setState((current) => goNext(current, targets))}
          >
            {t("correctionForm.next")}
          </Button>
        )}
        {state.step > 1 ? (
          <Button variant="plain" wide onClick={back}>
            {t("correctionForm.back")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
