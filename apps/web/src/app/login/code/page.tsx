import Link from "next/link";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/CodeForm";
import { verifyCode } from "@/lib/auth/actions/login";

/**
 * Always rendered the same way, with or without a (valid) flow cookie: a
 * rate-limited request gets no cookie, and that must not be visible here.
 */
export default function LoginCodePage() {
  return (
    <AuthShell
      title={t("loginCode.title")}
      intro={
        <p role="status" className="text-body text-ink-2">
          {t("loginCode.sent")}
        </p>
      }
    >
      <CodeForm
        id="login-code"
        label={t("loginCode.label")}
        hint={t("loginCode.hint")}
        submitLabel={t("loginCode.submit")}
        action={verifyCode}
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-callout text-ink-2">{t("loginCode.noMail")}</p>
        <Link
          href="/login"
          className="focus-ring inline-flex min-h-touch-target items-center rounded-control px-3 text-body font-semibold underline-offset-4 hover:underline"
        >
          {t("loginCode.restart")}
        </Link>
      </div>
    </AuthShell>
  );
}
