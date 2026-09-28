"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";
import type { SchedulePattern } from "@cloxa/db";

import { formStateToPattern } from "@/lib/schedule/form-state";
import { formatWeeklyHours, weeklyMinutes } from "@/lib/schedule/hours";
import { isLeadTimeShort } from "@/lib/schedule/lead-time";
import {
  copyMondayToWorkdays,
  emptyTemplate,
  fullTimeTemplate,
  partTimeMorningTemplate,
} from "@/lib/schedule/templates";
import {
  MAX_BLOCKS_PER_DAY,
  SCHEDULE_DAY_KEYS,
  type ScheduleDayKey,
  type ScheduleFormBlock,
  type ScheduleFormState,
} from "@/lib/schedule/types";
import {
  validateScheduleForm,
  type ScheduleBlockErrorCode,
} from "@/lib/schedule/validate";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Heading } from "../ui/Heading";
import { TextInput } from "../ui/TextInput";

export interface ScheduleEditorProps {
  initialForm: ScheduleFormState;
  todayKey: string;
  defaultValidFrom: string;
  action: (input: {
    validFrom: string;
    pattern: SchedulePattern;
  }) => Promise<{ ok: boolean; errorKey?: string }>;
}

const DAY_ERROR_KEY: Record<ScheduleBlockErrorCode, CatalogKey> = {
  tooManyBlocks: "schedule.errorTooManyBlocks",
  invalidTime: "schedule.errorInvalidTime",
  zeroLength: "schedule.errorZeroLength",
  overlap: "schedule.errorOverlap",
  afterOvernight: "schedule.errorAfterOvernight",
};

function emptyBlock(): ScheduleFormBlock {
  return { start: "09:00", end: "17:00" };
}

/**
 * Weekly editor for `/manage/medewerker/[id]/rooster`. Seven day rows, 0-3
 * blocks each, native `<input type="time">` controls. Validates client-side
 * with the same rules the database enforces (`lib/schedule/validate`) before
 * calling the bound `rpc_set_schedule` server action.
 */
export function ScheduleEditor({
  initialForm,
  todayKey,
  defaultValidFrom,
  action,
}: ScheduleEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState<ScheduleFormState>(initialForm);
  const [validFrom, setValidFrom] = useState(defaultValidFrom);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dayErrors = useMemo(() => validateScheduleForm(form), [form]);
  const totalMinutes = useMemo(() => weeklyMinutes(form), [form]);
  const leadTimeShort = useMemo(
    () => isLeadTimeShort(todayKey, validFrom),
    [todayKey, validFrom],
  );

  function updateDay(day: ScheduleDayKey, blocks: readonly ScheduleFormBlock[]) {
    setForm((current) => ({ ...current, [day]: blocks }));
    setSaved(false);
  }

  function updateBlock(
    day: ScheduleDayKey,
    index: number,
    field: "start" | "end",
    value: string,
  ) {
    const blocks = form[day].map((block, blockIndex) =>
      blockIndex === index ? { ...block, [field]: value } : block,
    );
    updateDay(day, blocks);
  }

  function addBlock(day: ScheduleDayKey) {
    if (form[day].length >= MAX_BLOCKS_PER_DAY) return;
    updateDay(day, [...form[day], emptyBlock()]);
  }

  function removeBlock(day: ScheduleDayKey, index: number) {
    updateDay(
      day,
      form[day].filter((_, blockIndex) => blockIndex !== index),
    );
  }

  function applyTemplate(template: () => ScheduleFormState) {
    setForm(template());
    setSaved(false);
  }

  function copyMonday() {
    setForm((current) => copyMondayToWorkdays(current));
    setSaved(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (Object.keys(dayErrors).length > 0) return;

    setSubmitting(true);
    setErrorKey(null);
    const result = await action({ validFrom, pattern: formStateToPattern(form) });
    setSubmitting(false);

    if (!result.ok) {
      setErrorKey(result.errorKey ?? "schedule.errorGeneric");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-8"
    >
      {saved ? (
        <Alert tone="success" onDismiss={() => setSaved(false)}>
          {t("schedule.saved")}
        </Alert>
      ) : null}
      {errorKey ? (
        <Alert tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey as CatalogKey)}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <Heading level={2}>{t("schedule.templatesHeading")}</Heading>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => applyTemplate(fullTimeTemplate)}
          >
            {t("schedule.templateFullTime")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => applyTemplate(partTimeMorningTemplate)}
          >
            {t("schedule.templatePartTimeMorning")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => applyTemplate(emptyTemplate)}
          >
            {t("schedule.templateEmpty")}
          </Button>
          <Button type="button" variant="quiet" size="md" onClick={copyMonday}>
            {t("schedule.copyMondayToWorkdays")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        {SCHEDULE_DAY_KEYS.map((day) => {
          const dayError = dayErrors[day];
          return (
            <div
              key={day}
              data-testid={`schedule-day-${day}`}
              className="flex flex-col gap-3 rounded-lg border border-border p-4"
            >
              <Heading level={3}>
                {t(`schedule.dayHeading.${day}` as CatalogKey)}
              </Heading>

              {form[day].length === 0 ? null : (
                <ul className="flex flex-col gap-3">
                  {form[day].map((block, index) => {
                    const overnight = block.end !== "" && block.end < block.start;
                    return (
                      <li key={index} className="flex flex-wrap items-end gap-3">
                        <Field
                          id={`schedule-${day}-${index}-start`}
                          label={t("schedule.startLabel")}
                        >
                          <TextInput
                            type="time"
                            value={block.start}
                            onChange={(event) =>
                              updateBlock(day, index, "start", event.target.value)
                            }
                          />
                        </Field>
                        <Field
                          id={`schedule-${day}-${index}-end`}
                          label={t("schedule.endLabel")}
                          {...(overnight ? { hint: t("schedule.overnightHint") } : {})}
                        >
                          <TextInput
                            type="time"
                            value={block.end}
                            onChange={(event) =>
                              updateBlock(day, index, "end", event.target.value)
                            }
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="quiet"
                          size="md"
                          onClick={() => removeBlock(day, index)}
                          aria-label={t("schedule.removeBlock")}
                        >
                          {t("schedule.removeBlock")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {dayError ? (
                <p role="alert" className="text-base font-semibold text-status-error">
                  {t(DAY_ERROR_KEY[dayError])}
                </p>
              ) : null}

              <div>
                <Button
                  type="button"
                  variant="quiet"
                  size="md"
                  onClick={() => addBlock(day)}
                  disabled={form[day].length >= MAX_BLOCKS_PER_DAY}
                >
                  {t("schedule.addBlock")}
                </Button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <Field
          id="schedule-valid-from"
          label={t("schedule.validFromLabel")}
          {...(leadTimeShort ? { hint: t("schedule.leadTimeWarning") } : {})}
        >
          <TextInput
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
            required
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <Heading level={2}>{t("schedule.summaryHeading")}</Heading>
        <p className="text-lg font-semibold">
          {t("schedule.summaryHours", { hours: formatWeeklyHours(totalMinutes) })}
        </p>
      </section>

      <div>
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={submitting}
          disabled={Object.keys(dayErrors).length > 0}
        >
          {t("schedule.submit")}
        </Button>
      </div>
    </form>
  );
}
