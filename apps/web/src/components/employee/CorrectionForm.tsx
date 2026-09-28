"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { RequestCorrectionInput } from "@cloxa/db";

import {
  buildCorrectionPayload,
  canAdvance,
  goBack,
  goNext,
  INITIAL_CORRECTION_FORM_STATE,
  type CorrectionEventType,
  type CorrectionFormState,
  type CorrectionKind,
  type CorrectionTargetOption,
} from "@/lib/corrections/form";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Heading } from "../ui/Heading";
import { Stack } from "../ui/Stack";
import { TextInput } from "../ui/TextInput";

export interface CorrectionFormProps {
  siteId: string;
  /** Effective events on the day the correction started from, for "adjust"/"remove". */
  targets: readonly CorrectionTargetOption[];
  defaultDate: string;
  submitAction: (
    input: RequestCorrectionInput,
  ) => Promise<{ ok: boolean; errorKey?: string }>;
}

const KIND_OPTIONS: readonly { kind: CorrectionKind; labelKey: string }[] = [
  { kind: "add", labelKey: "correctionForm.kindAdd" },
  { kind: "adjust", labelKey: "correctionForm.kindAdjust" },
  { kind: "remove", labelKey: "correctionForm.kindRemove" },
];

const EVENT_TYPE_OPTIONS: readonly { type: CorrectionEventType; labelKey: string }[] = [
  { type: "clock_in", labelKey: "correctionForm.eventTypeClockIn" },
  { type: "clock_out", labelKey: "correctionForm.eventTypeClockOut" },
  { type: "break_start", labelKey: "correctionForm.eventTypeBreakStart" },
  { type: "break_end", labelKey: "correctionForm.eventTypeBreakEnd" },
];

const KIND_LABEL_KEY: Record<CorrectionKind, string> = {
  add: "correctionForm.kindAdd",
  adjust: "correctionForm.kindAdjust",
  remove: "correctionForm.kindRemove",
};

export function CorrectionForm({
  siteId,
  targets,
  defaultDate,
  submitAction,
}: CorrectionFormProps) {
  const router = useRouter();
  const [state, setState] = useState<CorrectionFormState>({
    ...INITIAL_CORRECTION_FORM_STATE,
    date: defaultDate,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const payload = useMemo(() => buildCorrectionPayload(state, siteId), [state, siteId]);

  if (done) {
    return <Alert tone="success">{t("correctionForm.submitted")}</Alert>;
  }

  async function handleSubmit() {
    if (payload === null) return;
    const toSubmit = payload;
    setSubmitting(true);
    setError(null);
    const result = await submitAction(toSubmit);
    setSubmitting(false);
    if (!result.ok) {
      setError(
        t(
          (result.errorKey as Parameters<typeof t>[0]) ?? "correctionForm.genericError",
        ),
      );
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <Stack gap="lg">
      <p className="text-base text-ink/70">
        {t("correctionForm.stepOf", { step: state.step })}
      </p>
      {error ? (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {state.step === 1 ? (
        <Stack gap="md">
          <Heading level={2}>{t("correctionForm.step1Title")}</Heading>
          {KIND_OPTIONS.map((option) => (
            <Button
              key={option.kind}
              variant={state.kind === option.kind ? "primary" : "secondary"}
              size="xl"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  kind: option.kind,
                  targetEventId: null,
                }))
              }
            >
              {t(option.labelKey as Parameters<typeof t>[0])}
            </Button>
          ))}
          <div>
            <Button
              variant="primary"
              size="md"
              disabled={!canAdvance(state, targets)}
              onClick={() => setState((current) => goNext(current, targets))}
            >
              {t("correctionForm.next")}
            </Button>
          </div>
        </Stack>
      ) : null}

      {state.step === 2 ? (
        <Stack gap="md">
          <Heading level={2}>
            {state.kind === "remove"
              ? t("correctionForm.step2TitleRemove")
              : t("correctionForm.step2Title")}
          </Heading>

          {state.kind === "add" ? (
            <Field id="event-type" label={t("correctionForm.eventTypeLabel")}>
              <select
                id="event-type"
                className="focus-ring min-h-touch-target rounded-md border-2 border-border bg-surface px-4 text-lg text-ink"
                value={state.eventType ?? ""}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    eventType: event.target.value as CorrectionEventType,
                  }))
                }
              >
                <option value="" disabled>
                  {t("correctionForm.eventTypeLabel")}
                </option>
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.type} value={option.type}>
                    {t(option.labelKey as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {(state.kind === "adjust" || state.kind === "remove") && (
            <Field
              id="target-event"
              label={t("correctionForm.targetLabel")}
              {...(targets.length === 0 ? { hint: t("correctionForm.noTargets") } : {})}
            >
              <select
                id="target-event"
                className="focus-ring min-h-touch-target rounded-md border-2 border-border bg-surface px-4 text-lg text-ink"
                value={state.targetEventId ?? ""}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    targetEventId: event.target.value || null,
                  }))
                }
              >
                <option value="" disabled>
                  {t("correctionForm.targetLabel")}
                </option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {t("correctionForm.targetOption", {
                      type: t(
                        EVENT_TYPE_OPTIONS.find((option) => option.type === target.type)
                          ?.labelKey as Parameters<typeof t>[0],
                      ),
                      time: formatBrusselsTime(new Date(target.occurredAtIso)),
                    })}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {state.kind !== "remove" ? (
            <>
              <Field id="date" label={t("correctionForm.dateLabel")}>
                <TextInput
                  id="date"
                  type="date"
                  value={state.date}
                  onChange={(event) =>
                    setState((current) => ({ ...current, date: event.target.value }))
                  }
                />
              </Field>
              <Field id="time" label={t("correctionForm.timeLabel")}>
                <TextInput
                  id="time"
                  type="time"
                  value={state.time}
                  onChange={(event) =>
                    setState((current) => ({ ...current, time: event.target.value }))
                  }
                />
              </Field>
            </>
          ) : null}

          <Stack row gap="md">
            <Button variant="secondary" size="md" onClick={() => setState(goBack)}>
              {t("correctionForm.back")}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!canAdvance(state, targets)}
              onClick={() => setState((current) => goNext(current, targets))}
            >
              {t("correctionForm.next")}
            </Button>
          </Stack>
        </Stack>
      ) : null}

      {state.step === 3 ? (
        <Stack gap="md">
          <Heading level={2}>{t("correctionForm.step3Title")}</Heading>
          <Field
            id="reason"
            label={t("correctionForm.reasonLabel")}
            hint={t("correctionForm.reasonHint")}
            optional
          >
            <TextInput
              id="reason"
              value={state.reason}
              maxLength={280}
              onChange={(event) =>
                setState((current) => ({ ...current, reason: event.target.value }))
              }
            />
          </Field>

          <Heading level={3}>{t("correctionForm.summaryTitle")}</Heading>
          <p>
            {t("correctionForm.summaryKind", {
              value: t(KIND_LABEL_KEY[state.kind ?? "add"] as Parameters<typeof t>[0]),
            })}
          </p>
          <p>
            {state.reason.trim()
              ? t("correctionForm.summaryReason", { value: state.reason.trim() })
              : t("correctionForm.summaryNoReason")}
          </p>

          <Stack row gap="md">
            <Button variant="secondary" size="md" onClick={() => setState(goBack)}>
              {t("correctionForm.back")}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={submitting}
              disabled={payload === null}
              onClick={() => void handleSubmit()}
            >
              {t("correctionForm.submit")}
            </Button>
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
