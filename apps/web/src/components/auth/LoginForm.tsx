"use client";

import { useActionState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Stack } from "@/components/ui/Stack";
import { TextInput } from "@/components/ui/TextInput";
import { requestCode } from "@/lib/auth/actions/login";
import { INITIAL_FORM_STATE } from "@/lib/auth/form-state";

import { TurnstileWidget } from "./TurnstileWidget";

export interface LoginFormProps {
  /** Already validated against the redirect allowlist, or null. */
  next: string | null;
  /** Set only when Turnstile is configured. */
  turnstileSiteKey: string | null;
}

export function LoginForm({ next, turnstileSiteKey }: LoginFormProps) {
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
        {turnstileSiteKey ? (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            action="login"
            resetSignal={state}
          />
        ) : null}
        <Button type="submit" wide loading={pending}>
          {t("login.submit")}
        </Button>
      </Stack>
    </form>
  );
}
