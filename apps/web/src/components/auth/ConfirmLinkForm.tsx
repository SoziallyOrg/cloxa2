"use client";

import { useActionState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { confirmEmailLink } from "@/lib/auth/actions/confirm";
import { INITIAL_FORM_STATE } from "@/lib/auth/form-state";

import { TurnstileWidget } from "./TurnstileWidget";

export interface ConfirmLinkFormProps {
  tokenHash: string;
  type: string;
  next: string | null;
  /** Set only when Turnstile is configured. */
  turnstileSiteKey: string | null;
}

/** One big button: the email link is only used when the person presses it. */
export function ConfirmLinkForm({
  tokenHash,
  type,
  next,
  turnstileSiteKey,
}: ConfirmLinkFormProps) {
  const [state, action, pending] = useActionState(confirmEmailLink, INITIAL_FORM_STATE);

  return (
    <form action={action}>
      <Stack gap="md">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {state.error ? (
          <p role="alert" className="text-lg font-semibold text-danger">
            {state.error}
          </p>
        ) : null}
        {turnstileSiteKey ? (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            action="confirm"
            resetSignal={state}
          />
        ) : null}
        <Button type="submit" wide loading={pending}>
          {t("auth.confirm.submit")}
        </Button>
      </Stack>
    </form>
  );
}
