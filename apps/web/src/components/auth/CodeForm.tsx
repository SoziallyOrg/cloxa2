"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { OtpInput } from "@/components/ui/OtpInput";
import { Stack } from "@/components/ui/Stack";
import type { FormState } from "@/lib/auth/form-state";
import { INITIAL_FORM_STATE } from "@/lib/auth/form-state";

export interface CodeFormProps {
  id: string;
  label: string;
  hint: string;
  submitLabel: string;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Extra hidden fields, e.g. the factor being confirmed. */
  hidden?: Readonly<Record<string, string>>;
}

/** One 6-digit code field and one button: shared by email-code and TOTP steps. */
export function CodeForm({
  id,
  label,
  hint,
  submitLabel,
  action,
  hidden,
}: CodeFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <form action={formAction} noValidate>
      <Stack gap="lg">
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Field
          id={id}
          label={label}
          hint={hint}
          {...(state.error ? { error: state.error } : {})}
        >
          <OtpInput name="code" maxLength={6} required autoFocus />
        </Field>
        <Button type="submit" size="xl" loading={pending}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  );
}
