"use client";

import Link from "next/link";
import { useActionState } from "react";

import { PILOT_EMPLOYEE_RANGES, PILOT_SECTORS } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextInput, inputClassName } from "@/components/ui/TextInput";
import { HONEYPOT_FIELD, INITIAL_PILOT_STATE } from "@/lib/pilot/form";
import { submitPilot } from "@/lib/pilot/actions";

export interface PilotFormProps {
  /** Set only when Turnstile is configured. */
  turnstileSiteKey: string | null;
}

/**
 * One column of plain fields, one black button. What people typed stays in
 * the form when something needs another look (React resets forms after an
 * action, so the values come back from the action's state).
 */
export function PilotForm({ turnstileSiteKey }: PilotFormProps) {
  const [state, action] = useActionState(submitPilot, INITIAL_PILOT_STATE);
  const { values, fieldErrors } = state;
  const error = (field: keyof typeof fieldErrors) => {
    const message = fieldErrors[field];
    return message ? { error: message } : {};
  };

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <Field id="pilot-company" label={t("pilot.company")} {...error("company")}>
        <TextInput
          name="company"
          autoComplete="organization"
          defaultValue={values.company}
          required
        />
      </Field>
      <Field
        id="pilot-vat"
        label={t("pilot.vat")}
        hint={t("pilot.vatHint")}
        {...error("vat")}
      >
        <TextInput
          name="vat"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={values.vat}
          required
        />
      </Field>
      <Field id="pilot-name" label={t("pilot.name")} {...error("name")}>
        <TextInput
          name="name"
          autoComplete="name"
          defaultValue={values.name}
          required
        />
      </Field>
      <Field id="pilot-email" label={t("pilot.email")} {...error("email")}>
        <TextInput
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={values.email}
          required
        />
      </Field>
      <Field id="pilot-phone" label={t("pilot.phone")} optional {...error("phone")}>
        <TextInput
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={values.phone}
        />
      </Field>
      <Field id="pilot-employees" label={t("pilot.employees")} {...error("employees")}>
        <select
          name="employees"
          className={inputClassName}
          defaultValue={values.employees}
          required
        >
          <option value="">{t("pilot.employeesPlaceholder")}</option>
          {PILOT_EMPLOYEE_RANGES.map((range) => (
            <option key={range} value={range}>
              {t(`pilot.range.${range}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="pilot-sector" label={t("pilot.sector")} {...error("sector")}>
        <select
          name="sector"
          className={inputClassName}
          defaultValue={values.sector}
          required
        >
          <option value="">{t("pilot.sectorPlaceholder")}</option>
          {PILOT_SECTORS.map((sector) => (
            <option key={sector} value={sector}>
              {t(`pilot.sectors.${sector}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="pilot-message"
        label={t("pilot.message")}
        hint={t("pilot.messageHint")}
        optional
        {...error("message")}
      >
        <textarea
          name="message"
          rows={4}
          maxLength={1000}
          defaultValue={values.message}
          className={`${inputClassName} py-3`}
        />
      </Field>

      {/* The trap for bots: out of sight, out of the tab order, ignored by screen readers. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
      >
        <label>
          {t("pilot.honeypot")}
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex min-h-touch-target cursor-pointer items-start gap-3 text-body">
          <input
            type="checkbox"
            name="consent"
            id="pilot-consent"
            className="mt-1 size-6 shrink-0 accent-ink"
            aria-invalid={fieldErrors.consent ? true : undefined}
            aria-describedby={fieldErrors.consent ? "pilot-consent-error" : undefined}
          />
          <span>{t("pilot.consent")}</span>
        </label>
        {fieldErrors.consent ? (
          <p
            id="pilot-consent-error"
            role="alert"
            className="text-subhead font-semibold text-danger"
          >
            {fieldErrors.consent}
          </p>
        ) : null}
        <p className="text-subhead text-ink-2">
          {t("pilot.privacyHint")}{" "}
          <Link href="/privacy" className="focus-ring rounded-sm underline">
            {t("pilot.privacyLink")}
          </Link>
        </p>
      </div>

      {turnstileSiteKey ? (
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          action="pilot"
          resetSignal={state}
        />
      ) : null}

      {state.error ? (
        <p role="alert" className="text-body font-semibold text-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton wide>{t("pilot.submit")}</SubmitButton>
    </form>
  );
}
