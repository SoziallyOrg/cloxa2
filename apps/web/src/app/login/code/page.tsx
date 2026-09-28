import Link from "next/link";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/CodeForm";
import { Stack } from "@/components/ui/Stack";
import { verifyCode } from "@/lib/auth/actions/login";

/**
 * Always rendered the same way, with or without a (valid) flow cookie: a
 * rate-limited request gets no cookie, and that must not be visible here.
 */
export default function LoginCodePage() {
  return (
    <AuthShell title={t("loginCode.title")}>
      <p
        role="status"
        className="rounded-md border-2 border-border bg-status-off-bg p-4 text-lg"
      >
        {t("loginCode.sent")}
      </p>
      <CodeForm
        id="login-code"
        label={t("loginCode.label")}
        hint={t("loginCode.hint")}
        submitLabel={t("loginCode.submit")}
        action={verifyCode}
      />
      <Stack gap="sm">
        <p className="text-base text-ink/70">{t("loginCode.noMail")}</p>
        <Link
          href="/login"
          className="focus-ring self-start text-lg font-semibold underline"
        >
          {t("loginCode.restart")}
        </Link>
      </Stack>
    </AuthShell>
  );
}
