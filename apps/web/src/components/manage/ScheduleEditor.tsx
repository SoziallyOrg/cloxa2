"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

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

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { ListItem, Row, Section } from "../ui/List";
import { Notice } from "../ui/Notice";
import { inputClassName } from "../ui/TextInput";

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

// Large, calm, filled: "08:00" in big tabular figures, the native picker behind it.
const TIME_INPUT = cx(
  inputClassName,
  "min-h-control min-w-0 px-3! text-title-3 tabular-nums",
);

function emptyBlock(): ScheduleFormBlock {
  return { start: "09:00", end: "17:00" };
}

/**
 * Weekly editor for `/manage/medewerker/[id]/rooster`: a soft group per
 * weekday with its blocks (0–3), each two large time fields. Validates with
 * the same rules the database enforces (`lib/schedule/validate`) before
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
  const hasErrors = Object.keys(dayErrors).length > 0;

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
    updateDay(
      day,
      form[day].map((block, blockIndex) =>
        blockIndex === index ? { ...block, [field]: value } : block,
      ),
    );
  }

  function applyTemplate(template: () => ScheduleFormState) {
    setForm(template());
    setSaved(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (hasErrors) return;

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
      <section aria-live="polite" className="flex flex-col gap-0.5 px-4">
        <p className="text-subhead text-ink-2">{t("schedule.weekLabel")}</p>
        <p className="text-number">{formatWeeklyHours(totalMinutes)}</p>
        <p className="text-subhead text-ink-2">{t("hours.indicative")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-subhead text-ink-2">
          {t("schedule.templatesHeading")}
        </h2>
        <div className="-mx-1 flex flex-wrap">
          {(
            [
              ["schedule.templateFullTime", () => applyTemplate(fullTimeTemplate)],
              [
                "schedule.templatePartTimeMorning",
                () => applyTemplate(partTimeMorningTemplate),
              ],
              ["schedule.templateEmpty", () => applyTemplate(emptyTemplate)],
              [
                "schedule.copyMondayToWorkdays",
                () => {
                  setForm((current) => copyMondayToWorkdays(current));
                  setSaved(false);
                },
              ],
            ] as const
          ).map(([label, onClick]) => (
            <Button key={label} type="button" variant="plain" onClick={onClick}>
              {t(label)}
            </Button>
          ))}
        </div>
      </section>

      {SCHEDULE_DAY_KEYS.map((day) => {
        const dayName = t(`schedule.dayHeading.${day}` as CatalogKey);
        const dayError = dayErrors[day];
        const full = form[day].length >= MAX_BLOCKS_PER_DAY;
        return (
          <Section
            key={day}
            header={dayName}
            data-testid={`schedule-day-${day}`}
            footer={
              dayError ? (
                <span role="alert" className="font-semibold text-danger">
                  {t(DAY_ERROR_KEY[dayError])}
                </span>
              ) : undefined
            }
          >
            {form[day].length === 0 ? (
              <ListItem className="text-body text-ink-2">
                {t("schedule.dayOff")}
              </ListItem>
            ) : null}
            {form[day].map((block, index) => {
              const overnight = block.end !== "" && block.end < block.start;
              const number = index + 1;
              const startId = `schedule-${day}-${index}-start`;
              const endId = `schedule-${day}-${index}-end`;
              return (
                <ListItem key={index} className="gap-2 py-3">
                  <div className="grid grid-cols-2 items-end gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="flex flex-col gap-1">
                      <span aria-hidden="true" className="text-subhead text-ink-2">
                        {t("schedule.startLabel")}
                      </span>
                      <input
                        id={startId}
                        type="time"
                        aria-label={t("schedule.timeFromLabel", {
                          day: dayName,
                          number,
                        })}
                        value={block.start}
                        onChange={(event) =>
                          updateBlock(day, index, "start", event.target.value)
                        }
                        className={TIME_INPUT}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span aria-hidden="true" className="text-subhead text-ink-2">
                        {t("schedule.endLabel")}
                      </span>
                      <input
                        id={endId}
                        type="time"
                        aria-label={t("schedule.timeToLabel", { day: dayName, number })}
                        value={block.end}
                        aria-describedby={overnight ? `${endId}-hint` : undefined}
                        onChange={(event) =>
                          updateBlock(day, index, "end", event.target.value)
                        }
                        className={TIME_INPUT}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateDay(
                          day,
                          form[day].filter((_, blockIndex) => blockIndex !== index),
                        )
                      }
                      aria-label={`${t("schedule.removeBlock")}: ${t("schedule.timeFromLabel", { day: dayName, number })}`}
                      className="focus-ring col-span-2 min-h-touch-target pressable justify-self-start rounded-control px-1 text-body text-danger sm:col-span-1"
                    >
                      {t("schedule.removeBlockShort")}
                    </button>
                  </div>
                  {overnight ? (
                    <p id={`${endId}-hint`} className="text-subhead text-ink-2">
                      {t("schedule.overnightHint")}
                    </p>
                  ) : null}
                </ListItem>
              );
            })}
            <Row
              icon={Plus}
              title={full ? t("schedule.maxBlocksReached") : t("schedule.addBlock")}
              disabled={full}
              onClick={() => updateDay(day, [...form[day], emptyBlock()])}
            />
          </Section>
        );
      })}

      <Section
        footer={
          <span className="flex flex-col gap-1">
            {leadTimeShort ? (
              <span className="font-medium text-attention">
                {t("schedule.leadTimeShort")}
              </span>
            ) : null}
            <span>{t("schedule.leadTimeWarning")}</span>
          </span>
        }
      >
        <ListItem className="py-3">
          <label htmlFor="schedule-valid-from" className="flex flex-col gap-1">
            <span className="text-subhead text-ink-2">
              {t("schedule.validFromLabel")}
            </span>
            <input
              id="schedule-valid-from"
              type="date"
              value={validFrom}
              required
              onChange={(event) => setValidFrom(event.target.value)}
              className={TIME_INPUT}
            />
          </label>
        </ListItem>
      </Section>

      <div className="flex flex-col gap-4">
        {saved ? (
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {t("schedule.saved")}
          </Notice>
        ) : null}
        {errorKey ? (
          <Notice tone="error" onDismiss={() => setErrorKey(null)}>
            {t(errorKey as CatalogKey)}
          </Notice>
        ) : null}
        <div className="md:max-w-xs">
          <Button type="submit" wide loading={submitting} disabled={hasErrors}>
            {t("schedule.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
