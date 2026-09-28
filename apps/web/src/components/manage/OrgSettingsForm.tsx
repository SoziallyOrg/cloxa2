"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ORG_SETTING_BOUNDS } from "@cloxa/db";
import { t, type CatalogKey } from "@cloxa/i18n";

import type { SettingsField, SettingsFormValues } from "@/lib/manage/settings-form";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextInput";

export interface OrgSettingsFormProps {
  initial: SettingsFormValues;
  action: (input: unknown) => Promise<{
    readonly ok: boolean;
    readonly errorKey?: CatalogKey;
    readonly invalidFields?: readonly SettingsField[];
  }>;
}

type NumberField = Exclude<SettingsField, "offlineClocking">;

const NUMBER_FIELDS: readonly {
  field: NumberField;
  id: string;
  label: CatalogKey;
  hint: CatalogKey;
  bounds: { readonly min: number; readonly max: number };
}[] = [
  {
    field: "retentionYears",
    id: "settings-retention",
    label: "orgSettings.retentionLabel",
    hint: "orgSettings.retentionHint",
    bounds: ORG_SETTING_BOUNDS.retentionYears,
  },
  {
    field: "offlineMaxSkewMinutes",
    id: "settings-skew",
    label: "orgSettings.skewLabel",
    hint: "orgSettings.skewHint",
    bounds: ORG_SETTING_BOUNDS.offlineMaxSkewMinutes,
  },
  {
    field: "correctionMaxAgeDays",
    id: "settings-correction",
    label: "orgSettings.correctionLabel",
    hint: "orgSettings.correctionHint",
    bounds: ORG_SETTING_BOUNDS.correctionMaxAgeDays,
  },
];

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

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-6"
      noValidate
    >
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

      {NUMBER_FIELDS.map(({ field, id, label, hint, bounds }) => (
        <Field
          key={field}
          id={id}
          label={t(label)}
          hint={t(hint)}
          {...(invalid.includes(field)
            ? {
                error: t("orgSettings.fieldInvalid", {
                  min: bounds.min,
                  max: bounds.max,
                }),
              }
            : {})}
        >
          <TextInput
            id={id}
            inputMode="numeric"
            value={values[field]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field]: event.target.value }))
            }
            required
          />
        </Field>
      ))}

      <div className="flex flex-col gap-2">
        <label className="flex min-h-touch-target items-center gap-3 text-lg font-semibold">
          <input
            type="checkbox"
            className="size-6"
            checked={offlineClocking}
            onChange={(event) => setOfflineClocking(event.target.checked)}
            aria-describedby="settings-offline-hint"
          />
          {t("orgSettings.offlineLabel")}
        </label>
        <p id="settings-offline-hint" className="text-ink-2">
          {t("orgSettings.offlineHint")}
        </p>
      </div>

      <div>
        <Button type="submit" variant="primary" size="md" loading={submitting}>
          {t("orgSettings.submit")}
        </Button>
      </div>
    </form>
  );
}
