"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import { pinFormProblem, pinProblemKey, type PinActionResult } from "@/lib/kiosk/pin";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Stack } from "../ui/Stack";
import { TextInput } from "../ui/TextInput";

export interface PinFormProps {
  /** Prefix for the field ids, unique on the page. */
  id: string;
  submitLabel: string;
  savedMessage: string;
  /**
   * `list`: the employee app: both fields in one white card, the button at the
   * bottom. `stack` (default): labelled fields above each other (manager pages).
   */
  variant?: "stack" | "list";
  action: (input: { pin: string; confirmation: string }) => Promise<PinActionResult>;
}

/**
 * A kiosk PIN and its repetition, checked here first with the same rules as
 * the database. Used by employees for their own PIN and by managers for
 * staff without a login.
 */
export function PinForm({
  id,
  submitLabel,
  savedMessage,
  action,
  variant = "stack",
}: PinFormProps) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const problem = pinFormProblem(pin, confirmation);
    if (problem) {
      setErrorKey(pinProblemKey(problem));
      return;
    }
    setSubmitting(true);
    setErrorKey(null);
    const result = await action({ pin, confirmation });
    setSubmitting(false);
    if (!result.ok) {
      setErrorKey(result.errorKey ?? "kiosk.pinErrorGeneric");
      return;
    }
    setPin("");
    setConfirmation("");
    setSaved(true);
    router.refresh();
  }

  const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);
  const error = errorKey ? t(errorKey) : undefined;

  if (variant === "list") {
    return (
      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-1 flex-col gap-6 pb-6 lg:max-w-readable"
      >
        {saved ? (
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {savedMessage}
          </Notice>
        ) : null}
        <div className="flex flex-col gap-5 rounded-card bg-card p-5 shadow-card">
          <Field
            id={`${id}-pin`}
            label={t("kiosk.pinNewLabel")}
            hint={t("kiosk.pinSettingsHint")}
            {...(error ? { error } : {})}
          >
            <TextInput
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(digitsOnly(event.target.value))}
            />
          </Field>
          <Field id={`${id}-repeat`} label={t("kiosk.pinRepeatLabel")}>
            <TextInput
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={confirmation}
              onChange={(event) => setConfirmation(digitsOnly(event.target.value))}
            />
          </Field>
        </div>
        <div className="mt-auto md:mt-0">
          <Button type="submit" wide loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Stack gap="md">
        {saved ? (
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {savedMessage}
          </Notice>
        ) : null}
        <Field
          id={`${id}-pin`}
          label={t("kiosk.pinNewLabel")}
          hint={t("kiosk.pinSettingsHint")}
          {...(error ? { error } : {})}
        >
          <TextInput
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(digitsOnly(event.target.value))}
          />
        </Field>
        <Field id={`${id}-repeat`} label={t("kiosk.pinRepeatLabel")}>
          <TextInput
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={confirmation}
            onChange={(event) => setConfirmation(digitsOnly(event.target.value))}
          />
        </Field>
        <div>
          <Button type="submit" wide loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
