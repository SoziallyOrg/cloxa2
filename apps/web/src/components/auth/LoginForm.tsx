"use client";

import { useActionState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Stack } from "@/components/ui/Stack";
import { TextInput } from "@/components/ui/TextInput";
import { requestCode } from "@/lib/auth/actions/login";
import { INITIAL_FORM_STATE } from "@/lib/auth/form-state";

export interface LoginFormProps {
  /** Already validated against the redirect allowlist, or null. */
  next: string | null;
}

export function LoginForm({ next }: LoginFormProps) {
  const [state, action, pending] = useActionState(requestCode, INITIAL_FORM_STATE);

  return (
    <form action={action} noValidate>
      <Stack gap="lg">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field
          id="login-email"
          label={t("login.emailLabel")}
          hint={t("login.emailHint")}
          {...(state.error ? { error: state.error } : {})}
        >
          <TextInput
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        </Field>
        <Button type="submit" size="xl" loading={pending}>
          {t("login.submit")}
        </Button>
      </Stack>
    </form>
  );
}
