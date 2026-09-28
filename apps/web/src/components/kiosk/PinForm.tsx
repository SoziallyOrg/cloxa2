"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import { pinFormProblem, pinProblemKey, type PinActionResult } from "@/lib/kiosk/pin";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Row, Section } from "../ui/List";
import { Stack } from "../ui/Stack";
import { TextInput } from "../ui/TextInput";

export interface PinFormProps {
  /** Prefix for the field ids, unique on the page. */
  id: string;
  submitLabel: string;
  savedMessage: string;
  /**
   * `list`: iOS settings style (employee app): both fields as rows of one
   * inset group, the button at the bottom. `stack` (default): labelled
   * fields above each other (manager pages).
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
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const input = (
      inputId: string,
      value: string,
      onChange: (next: string) => void,
    ) => (
      <input
        id={inputId}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={value}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error ? true : undefined}
        placeholder="••••"
        onChange={(event) => onChange(digitsOnly(event.target.value))}
        className="focus-ring min-h-touch-target w-28 shrink-0 rounded-md border-0 bg-transparent px-2 text-right text-body tracking-[0.2em] text-ink placeholder:tracking-normal placeholder:text-ink-3"
      />
    );

    return (
      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-1 flex-col gap-8 pb-6"
      >
        {saved ? (
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {savedMessage}
          </Notice>
        ) : null}
        <Section
          footer={
            <span className="flex flex-col gap-1">
              {error ? (
                <span id={errorId} role="alert" className="font-semibold text-danger">
                  {error}
                </span>
              ) : null}
              <span id={hintId}>{t("kiosk.pinSettingsHint")}</span>
            </span>
          }
        >
          <Row
            title={<label htmlFor={`${id}-pin`}>{t("kiosk.pinNewLabel")}</label>}
            accessory={input(`${id}-pin`, pin, setPin)}
          />
          <Row
            title={<label htmlFor={`${id}-repeat`}>{t("kiosk.pinRepeatLabel")}</label>}
            accessory={input(`${id}-repeat`, confirmation, setConfirmation)}
          />
        </Section>
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
