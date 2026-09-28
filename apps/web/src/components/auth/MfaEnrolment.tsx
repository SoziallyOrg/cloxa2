"use client";

import { useActionState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { confirmEnrolment, startEnrolment } from "@/lib/auth/actions/mfa";
import { groupSecret, INITIAL_ENROL_STATE } from "@/lib/auth/form-state";

import { CodeForm } from "./CodeForm";

/**
 * Two steps on one screen: create the factor on request (never on page
 * load, so a GET changes nothing), then scan or type the secret and confirm
 * with a first code.
 */
export function MfaEnrolment() {
  const [state, start, pending] = useActionState(startEnrolment, INITIAL_ENROL_STATE);

  if (!state.enrolment) {
    return (
      <form action={start}>
        <Stack gap="md">
          {state.error ? (
            <p role="alert" className="text-lg font-semibold text-danger">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" wide loading={pending}>
            {t("mfa.setupStart")}
          </Button>
        </Stack>
      </form>
    );
  }

  const { factorId, qrCode, secret } = state.enrolment;

  return (
    <Stack gap="lg">
      <p className="text-lg">{t("mfa.scanStep")}</p>
      <div className="self-start rounded-md border border-line bg-white p-3">
        {/* A data: URI from Supabase; next/image would add a CSP-blocked inline style. */}
        <img src={qrCode} alt={t("mfa.qrAlt")} width={200} height={200} />
      </div>
      <Stack gap="sm">
        <p className="text-lg">{t("mfa.secretLabel")}</p>
        <p
          data-testid="totp-secret"
          className="font-mono text-xl tracking-wider break-all select-all"
        >
          {groupSecret(secret)}
        </p>
      </Stack>
      <CodeForm
        id="mfa-enrol-code"
        label={t("mfa.codeLabel")}
        hint={t("mfa.codeHint")}
        submitLabel={t("mfa.setupSubmit")}
        action={confirmEnrolment}
        hidden={{ factorId }}
      />
    </Stack>
  );
}
