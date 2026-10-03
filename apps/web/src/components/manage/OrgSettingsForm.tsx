"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";

import { ORG_SETTING_BOUNDS } from "@cloxa/db";
import { t, type CatalogKey } from "@cloxa/i18n";

import type { SettingsField, SettingsFormValues } from "@/lib/manage/settings-form";

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { ListItem, Row, Section } from "../ui/List";
import { Notice } from "../ui/Notice";
import { Switch } from "../ui/Switch";

export interface OrgSettingsFormProps {
  initial: SettingsFormValues;
  action: (input: unknown) => Promise<{
    readonly ok: boolean;
    readonly errorKey?: CatalogKey;
    readonly invalidFields?: readonly SettingsField[];
  }>;
}

type NumberField = Exclude<SettingsField, "offlineClocking">;

interface NumberSetting {
  field: NumberField;
  id: string;
  label: CatalogKey;
  unit: CatalogKey;
  hint: CatalogKey;
  step: number;
  bounds: { readonly min: number; readonly max: number };
}

const RETENTION: NumberSetting = {
  field: "retentionYears",
  id: "settings-retention",
  label: "orgSettings.retentionShort",
  unit: "orgSettings.retentionUnit",
  hint: "orgSettings.retentionHint",
  step: 1,
  bounds: ORG_SETTING_BOUNDS.retentionYears,
};
const SKEW: NumberSetting = {
  field: "offlineMaxSkewMinutes",
  id: "settings-skew",
  label: "orgSettings.skewShort",
  unit: "orgSettings.skewUnit",
  hint: "orgSettings.skewHint",
  step: 5,
  bounds: ORG_SETTING_BOUNDS.offlineMaxSkewMinutes,
};
const CORRECTION: NumberSetting = {
  field: "correctionMaxAgeDays",
  id: "settings-correction",
  label: "orgSettings.correctionShort",
  unit: "orgSettings.correctionUnit",
  hint: "orgSettings.correctionHint",
  step: 1,
  bounds: ORG_SETTING_BOUNDS.correctionMaxAgeDays,
};

const STEP_BUTTON =
  "focus-ring flex size-touch-target shrink-0 pressable items-center justify-center rounded-full text-ink disabled:opacity-40";

/** The org settings; validated on the server (`validateSettingsForm`) and in the database. */
export function OrgSettingsForm({ initial, action }: OrgSettingsFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<NumberField, string>>({
    retentionYears: String(initial.retentionYears),
    offlineMaxSkewMinutes: String(initial.offlineMaxSkewMinutes),
    correctionMaxAgeDays: String(initial.correctionMaxAgeDays),
  });
  const [offlineClocking, setOfflineClocking] = useState(initial.offlineClocking);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [invalid, setInvalid] = useState<readonly SettingsField[]>([]);
  const [saved, setSaved] = useState(false);

  function set(field: NumberField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    setInvalid([]);
    setSaved(false);
    const result = await action({ ...values, offlineClocking });
    setSubmitting(false);
    if (!result.ok) {
      setInvalid(result.invalidFields ?? []);
      if (result.errorKey) setErrorKey(result.errorKey);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  function numberSetting(setting: NumberSetting) {
    const { field, id, label, unit, hint, step, bounds } = setting;
    const error = invalid.includes(field)
      ? t("orgSettings.fieldInvalid", { min: bounds.min, max: bounds.max })
      : null;
    const current = Number.parseInt(values[field], 10);
    const stepTo = (delta: number) => {
      const base = Number.isFinite(current) ? current : bounds.min;
      set(field, String(Math.min(bounds.max, Math.max(bounds.min, base + delta))));
    };
    const name = t(label);

    return (
      <Section
        footer={
          <span className="flex flex-col gap-1">
            {error ? (
              <span
                id={`${id}-error`}
                role="alert"
                className="font-semibold text-danger"
              >
                {error}
              </span>
            ) : null}
            <span id={`${id}-hint`}>{t(hint)}</span>
          </span>
        }
      >
        <ListItem className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <label htmlFor={id} className="min-w-0 text-body">
              {name}
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t("orgSettings.decrease", { label: name })}
                disabled={Number.isFinite(current) && current <= bounds.min}
                onClick={() => stepTo(-step)}
                className={STEP_BUTTON}
              >
                <Minus aria-hidden="true" className="size-5" strokeWidth={2} />
              </button>
              <input
                id={id}
                inputMode="numeric"
                value={values[field]}
                onChange={(event) => set(field, event.target.value.replace(/\D/g, ""))}
                aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
                aria-invalid={error ? true : undefined}
                className={cx(
                  "min-h-touch-target w-16 rounded-control border border-field bg-card text-center text-body text-ink tabular-nums",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
                  "aria-invalid:ring-2 aria-invalid:ring-danger",
                )}
              />
              <button
                type="button"
                aria-label={t("orgSettings.increase", { label: name })}
                disabled={Number.isFinite(current) && current >= bounds.max}
                onClick={() => stepTo(step)}
                className={STEP_BUTTON}
              >
                <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
              </button>
              <span className="w-32 pl-1 text-body text-ink-2">{t(unit)}</span>
            </div>
          </div>
        </ListItem>
      </Section>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-8"
      noValidate
    >
      {numberSetting(RETENTION)}

      <Section footer={t("orgSettings.offlineHint")}>
        <Row
          title={t("orgSettings.offlineShort")}
          accessory={
            <Switch
              label={t("orgSettings.offlineLabel")}
              checked={offlineClocking}
              onCheckedChange={(next) => {
                setOfflineClocking(next);
                setSaved(false);
              }}
            />
          }
        />
      </Section>

      {offlineClocking ? numberSetting(SKEW) : null}
      {numberSetting(CORRECTION)}

      <div className="flex flex-col gap-4">
        {saved ? (
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {t("orgSettings.saved")}
          </Notice>
        ) : null}
        {errorKey ? (
          <Notice tone="error" onDismiss={() => setErrorKey(null)}>
            {t(errorKey)}
          </Notice>
        ) : null}
        <div className="md:max-w-xs">
          <Button type="submit" wide loading={submitting}>
            {t("orgSettings.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
