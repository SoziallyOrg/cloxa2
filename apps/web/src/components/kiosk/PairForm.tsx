"use client";

import { useActionState } from "react";

import { t } from "@cloxa/i18n";

import { INITIAL_FORM_STATE, type FormState } from "@/lib/auth/form-state";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Stack } from "../ui/Stack";

export interface PairFormProps {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
}

/** The pairing code, large and forgiving: lowercase, spaces and a dash are fine. */
export function PairForm({ action }: PairFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <form action={formAction} noValidate>
      <Stack gap="lg">
        <Field
          id="kiosk-pair-code"
          label={t("kiosk.pairLabel")}
          hint={t("kiosk.pairHint")}
          {...(state.error ? { error: state.error } : {})}
        >
          <input
            name="code"
            type="text"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            className="focus-ring min-h-primary-action rounded-md border-2 border-border bg-surface px-4 text-center font-mono text-4xl tracking-widest text-ink uppercase aria-invalid:border-status-error"
          />
        </Field>
        <Button type="submit" size="xl" loading={pending}>
          {t("kiosk.pairSubmit")}
        </Button>
      </Stack>
    </form>
  );
}
